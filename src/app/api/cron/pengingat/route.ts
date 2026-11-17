import '@/lib/http-agent'
import { NextResponse, type NextRequest } from 'next/server'
import { reminderKeyboard, reminderText, sendDashboard } from '@/lib/bot'
import { eveningPanel, firedMessage } from '@/lib/bot/timers'
import { hhmmIn, nextOccurrence } from '@/lib/bot/when'
import { renderPanel } from '@/lib/bot/ui'
import { DEFAULT_TZ, isValidTimeZone, todayIn } from '@/lib/dates'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches, sendMessageKb } from '@/lib/telegram'

export const maxDuration = 60

const MAX_ATTEMPTS = 5

interface Claimed {
  id: string; user_id: string; kind: string; title: string; due_at: string | null; start_at: string | null; end_at: string | null
  location: string; remind_before_minutes: number; remind_attempts: number; chat_id: number | null; timezone: string
}

/**
 * Dipanggil pg_cron (Supabase) setiap menit dengan header Authorization: Bearer CRON_SECRET.
 *  0. Timer & "ingatkan saya" yang waktunya tiba (diklaim atomik).
 *  1. Pengingat tugas/kegiatan yang jatuh tempo (diklaim atomik → tidak terkirim dua kali).
 *     Gagal kirim → dicatat di reminder_logs & dicoba lagi putaran berikutnya (maks. 5×) — UJ-12.
 *  2. Ringkasan harian sekali sehari pada jam pilihan pengguna (default 07:00 waktu setempat).
 *  3. Cek sore (default 19:00): tugas hari ini yang belum selesai — dikirim hanya bila masih ada.
 */
async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!secretMatches(auth.replace(/^Bearer\s+/i, ''), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const db = createAdminClient()
  const stats = { timers: 0, reminders: 0, sent: 0, failed: 0, skipped: 0, digests: 0, digestFailed: 0, evenings: 0 }
  const logs: Array<{ user_id: string; task_id: string | null; kind: string; status: string; detail: string }> = []

  /* ---- 0. Timer & "ingatkan saya" (paling sensitif waktu → paling awal) ---- */
  const { data: due } = await db.rpc('claim_due_timers', { p_limit: 200 })
  const timers = (due ?? []) as Array<{ id: string; user_id: string; kind: string; label: string; minutes: number | null; fire_at: string; attempts: number; repeat?: string | null; chat_id: number | null; timezone: string }>
  stats.timers = timers.length
  await Promise.all(timers.map(async (t) => {
    if (!t.chat_id) { logs.push({ user_id: t.user_id, task_id: null, kind: 'timer', status: 'dilewati', detail: 'Telegram belum ditautkan' }); return }
    const tz = isValidTimeZone(t.timezone) ? t.timezone : DEFAULT_TZ
    // Berulang → jadwalkan kejadian berikutnya (sekali saja, pada klaim pertama).
    let next: { id: string; at: string } | undefined
    if (t.repeat && t.attempts === 0) {
      const at = nextOccurrence(t.repeat, hhmmIn(t.fire_at, tz), tz, new Date(Math.max(Date.now(), new Date(t.fire_at).getTime())))
      if (at) {
        const { data: row } = await db.from('bot_timers').insert({ user_id: t.user_id, kind: 'ingat', label: t.label, fire_at: at, repeat: t.repeat }).select('id').single()
        if (row) next = { id: row.id as string, at }
      }
    }
    const m = firedMessage(t, tz, next)
    const res = await sendMessageKb(t.chat_id, m.html, m.kb)
    if (res.ok) { logs.push({ user_id: t.user_id, task_id: null, kind: 'timer', status: 'terkirim', detail: '' }); return }
    // Gagal sementara → lepaskan klaim agar dicoba lagi menit berikutnya (maks. 5×).
    const retry = res.retryable && t.attempts + 1 < MAX_ATTEMPTS
    await db.from('bot_timers').update({ attempts: t.attempts + 1, ...(retry ? { sent_at: null } : {}) }).eq('id', t.id)
    logs.push({ user_id: t.user_id, task_id: null, kind: 'timer', status: 'gagal', detail: res.error.slice(0, 500) })
  }))

  /* ---- 1. Pengingat tugas ---- */
  const { data: claimed, error } = await db.rpc('claim_due_reminders', { p_limit: 100 })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const rows = (claimed ?? []) as Claimed[]
  stats.reminders = rows.length

  for (let i = 0; i < rows.length; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(async (t) => {
      if (!t.chat_id) {
        stats.skipped++
        logs.push({ user_id: t.user_id, task_id: t.id, kind: 'tugas', status: 'dilewati', detail: 'Telegram belum ditautkan' })
        return
      }
      const tz = isValidTimeZone(t.timezone) ? t.timezone : DEFAULT_TZ
      const res = await sendMessageKb(t.chat_id, reminderText(t, tz), reminderKeyboard(t))
      if (res.ok) {
        stats.sent++
        logs.push({ user_id: t.user_id, task_id: t.id, kind: 'tugas', status: 'terkirim', detail: '' })
        return
      }
      stats.failed++
      const attempts = t.remind_attempts + 1
      const retry = res.retryable && attempts < MAX_ATTEMPTS
      // Coba lagi: lepaskan klaim (reminded_at = null). Menyerah: biarkan reminded_at terisi.
      await db.from('tasks').update({ remind_attempts: attempts, ...(retry ? { reminded_at: null } : {}) }).eq('id', t.id)
      logs.push({ user_id: t.user_id, task_id: t.id, kind: 'tugas', status: 'gagal', detail: `${retry ? `Percobaan ${attempts}, dicoba lagi` : 'Tidak dicoba lagi'}: ${res.error}`.slice(0, 500) })
    }))
  }

  /* ---- 2. Ringkasan harian ---- */
  const { data: conns } = await db.from('telegram_connections').select('user_id, chat_id').limit(5000)
  if (conns?.length) {
    const { data: profs } = await db.from('profiles').select('id, display_name, timezone, notification_settings, last_digest_on').in('id', conns.map((c) => c.user_id))
    const byId = new Map((profs ?? []).map((p) => [p.id as string, p]))
    const now = new Date()
    for (const c of conns) {
      const p = byId.get(c.user_id)
      if (!p) continue
      const s = (p.notification_settings ?? {}) as { digest?: boolean; digest_time?: string }
      if (s.digest === false) continue
      const tz = isValidTimeZone(p.timezone) ? p.timezone : DEFAULT_TZ
      const today = todayIn(tz, now)
      if (p.last_digest_on && p.last_digest_on >= today) continue
      const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
      if (hhmm < (/^\d{2}:\d{2}$/.test(s.digest_time ?? '') ? s.digest_time! : '07:00')) continue

      // Klaim hari ini dulu (atomik) supaya putaran bertumpuk tidak mengirim dua kali.
      let claim = db.from('profiles').update({ last_digest_on: today }).eq('id', c.user_id)
      claim = p.last_digest_on ? claim.eq('last_digest_on', p.last_digest_on) : claim.is('last_digest_on', null)
      const { data: got } = await claim.select('id')
      if (!got?.length) continue

      const [habits, checks] = await Promise.all([
        db.from('habits').select('id', { count: 'exact', head: true }).eq('user_id', c.user_id).eq('is_archived', false).eq('frequency', 'harian'),
        db.from('habit_checkins').select('id', { count: 'exact', head: true }).eq('user_id', c.user_id).eq('checkin_date', today),
      ])
      const habitLeft = Math.max((habits.count ?? 0) - (checks.count ?? 0), 0)
      // Pesan beranda (banner + ringkasan + menu) — sama dengan /menu.
      const res = await sendDashboard(
        { db, chatId: Number(c.chat_id), userId: c.user_id, tz, name: p.display_name || 'Kamu' },
        habitLeft ? `<b>${habitLeft} kebiasaan harian</b> menunggu check-in.` : undefined,
      )
      if (res.ok) {
        stats.digests++
        logs.push({ user_id: c.user_id, task_id: null, kind: 'ringkasan', status: 'terkirim', detail: '' })
      } else {
        stats.digestFailed++
        // Gagal sementara → lepaskan klaim agar dicoba lagi 5 menit kemudian.
        if (res.retryable) await db.from('profiles').update({ last_digest_on: p.last_digest_on }).eq('id', c.user_id)
        logs.push({ user_id: c.user_id, task_id: null, kind: 'ringkasan', status: 'gagal', detail: res.error.slice(0, 500) })
      }
    }
  }

  /* ---- 3. Cek sore: tugas hari ini yang belum selesai ---- */
  if (conns?.length) {
    const { data: profs } = await db.from('profiles').select('id, display_name, timezone, notification_settings, last_evening_on').in('id', conns.map((c) => c.user_id))
    const byId = new Map((profs ?? []).map((p) => [p.id as string, p]))
    const now = new Date()
    for (const c of conns) {
      const p = byId.get(c.user_id)
      if (!p) continue
      const s = (p.notification_settings ?? {}) as { evening?: boolean; evening_time?: string }
      if (s.evening === false) continue
      const tz = isValidTimeZone(p.timezone) ? p.timezone : DEFAULT_TZ
      const today = todayIn(tz, now)
      if (p.last_evening_on && p.last_evening_on >= today) continue
      const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
      if (hhmm < (/^\d{2}:\d{2}$/.test(s.evening_time ?? '') ? s.evening_time! : '19:00')) continue
      // Klaim hari ini dulu (atomik) supaya putaran bertumpuk tidak mengirim dua kali.
      let claim = db.from('profiles').update({ last_evening_on: today }).eq('id', c.user_id)
      claim = p.last_evening_on ? claim.eq('last_evening_on', p.last_evening_on) : claim.is('last_evening_on', null)
      const { data: got } = await claim.select('id')
      if (!got?.length) continue
      const panel = await eveningPanel({ db, userId: c.user_id, tz, name: p.display_name || 'Kamu' })
      if (!panel) continue // semua tugas hari ini sudah beres → tidak perlu mengganggu
      const res = await sendMessageKb(Number(c.chat_id), renderPanel(panel, 4000), panel.kb)
      if (res.ok) { stats.evenings++; logs.push({ user_id: c.user_id, task_id: null, kind: 'sore', status: 'terkirim', detail: '' }) }
      else {
        if (res.retryable) await db.from('profiles').update({ last_evening_on: p.last_evening_on }).eq('id', c.user_id)
        logs.push({ user_id: c.user_id, task_id: null, kind: 'sore', status: 'gagal', detail: res.error.slice(0, 500) })
      }
    }
  }

  if (logs.length) await db.from('reminder_logs').insert(logs)
  // Bersihkan jejak lama sekali per jam (cron berjalan tiap menit).
  if (new Date().getUTCMinutes() === 0) {
    // Pengingat berulang yang terlewat > 6 jam (mis. server mati) → geser ke kejadian berikutnya agar rantainya tidak putus.
    const { data: stale } = await db.from('bot_timers').select('id, user_id, fire_at, repeat')
      .is('sent_at', null).not('repeat', 'is', null).lt('fire_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).limit(200)
    if (stale?.length) {
      const { data: tzs } = await db.from('profiles').select('id, timezone').in('id', [...new Set(stale.map((s) => s.user_id))])
      const tzOf = new Map((tzs ?? []).map((p) => [p.id as string, isValidTimeZone(p.timezone) ? p.timezone : DEFAULT_TZ]))
      await Promise.all(stale.map(async (s) => {
        const tz = tzOf.get(s.user_id) ?? DEFAULT_TZ
        const at = nextOccurrence(s.repeat!, hhmmIn(s.fire_at, tz), tz, new Date())
        if (at) await db.from('bot_timers').update({ fire_at: at, attempts: 0 }).eq('id', s.id)
      }))
    }
    await Promise.all([
      db.from('bot_timers').delete().not('sent_at', 'is', null).lt('sent_at', new Date(Date.now() - 2 * 86_400_000).toISOString()),
      db.from('telegram_updates').delete().lt('processed_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
      db.from('telegram_link_codes').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString()),
      db.from('telegram_pending').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString()),
    ])
  }
  return NextResponse.json({ ok: true, ...stats })
}

export const GET = run
export const POST = run
