import { NextResponse, type NextRequest } from 'next/server'
import { handleUpdate, type TgUpdate } from '@/lib/bot'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/telegram'

export const maxDuration = 30

/**
 * Webhook Bot Telegram.
 *  - Hanya menerima permintaan yang membawa header rahasia (diatur saat setWebhook).
 *  - update_id dicatat dulu; Telegram yang mengirim ulang update yang sama tidak diproses dua kali.
 *  - Selalu membalas 200 setelah update tercatat, agar Telegram tidak mengulang terus bila handler gagal.
 */
export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const update = (await req.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update.update_id !== 'number') return NextResponse.json({ ok: true })

  const db = createAdminClient()
  const { error } = await db.from('telegram_updates').insert({ update_id: update.update_id })
  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    return NextResponse.json({ ok: false }, { status: 500 }) // DB bermasalah → biarkan Telegram mengulang
  }

  let status: 'selesai' | 'diabaikan' | 'gagal' = 'gagal'
  try {
    status = await handleUpdate(db, update)
  } catch (e) {
    console.error('telegram webhook', update.update_id, e)
  }
  await db.from('telegram_updates').update({ status }).eq('update_id', update.update_id)
  return NextResponse.json({ ok: true })
}
