import '@/lib/http-agent'
import { after, NextResponse, type NextRequest } from 'next/server'
import { handleUpdate, type BotUser, type TgUpdate } from '@/lib/bot'
import { runTimed, serverTiming, timed } from '@/lib/bot/timing'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/telegram'

export const maxDuration = 30

/**
 * Webhook Bot Telegram.
 *  - Hanya menerima permintaan yang membawa header rahasia (diatur saat setWebhook).
 *  - bot_begin(): satu panggilan DB untuk mencatat update_id (idempoten) sekaligus memuat pengguna.
 *  - Pencatatan status dijalankan setelah respons (after) agar tidak menambah waktu tunggu.
 *  - Selalu membalas 200 setelah update tercatat, agar Telegram tidak mengulang terus bila handler gagal.
 */
export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update.update_id !== 'number') return NextResponse.json({ ok: true })

  const t0 = performance.now()
  return runTimed(async () => {
    const db = createAdminClient()
    const from = update.message?.from ?? update.callback_query?.from
    const chat = update.message?.chat ?? update.callback_query?.message?.chat
    const { data, error } = await timed('db.begin', db.rpc('bot_begin', {
      p_update_id: update.update_id,
      p_telegram_user: from?.id ?? null,
      p_chat: chat?.type === 'private' ? chat.id : null, // jangan pernah menyimpan chat grup
    }).single<{ duplicate: boolean; user_id: string | null; display_name: string | null; timezone: string | null }>())
    if (error || !data) return NextResponse.json({ ok: false }, { status: 500 }) // DB bermasalah → biarkan Telegram mengulang
    if (data.duplicate) return NextResponse.json({ ok: true, duplicate: true })

    const user: BotUser | null = data.user_id ? { userId: data.user_id, name: data.display_name ?? '', tz: data.timezone ?? 'Asia/Jakarta' } : null
    let status: 'selesai' | 'diabaikan' | 'gagal' = 'gagal'
    try {
      status = await handleUpdate(db, update, user)
    } catch (e) {
      console.error('telegram webhook', update.update_id, e)
    }
    after(async () => { await db.from('telegram_updates').update({ status }).eq('update_id', update.update_id) })
    return NextResponse.json({ ok: true }, { headers: { 'Server-Timing': serverTiming(performance.now() - t0) } })
  })
}

/** Ping ringan dari pg_cron agar fungsi tetap "hangat" (tanpa cold start saat tombol ditekan). */
export function GET() {
  return NextResponse.json({ ok: true })
}
