import 'server-only'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatShort, formatTime } from '../format'
import type { Keyboard } from '../telegram'
import { OPEN, btn, cut, esc, navRow, rows, type Ctx, type Panel } from './ui'
import { cleanReminderLabel, extractRepeat, extractWhen, hhmmIn, minutesLabel, nextOccurrence, repeatLabel, whenLabel } from './when'

/* Timer hitung mundur, "ingatkan saya", dan cek sore — semuanya dikirim cron setiap menit. */

export const MAX_ACTIVE = 20
const PRESETS = [5, 15, 25, 50]

/** "25", "25m", "25 menit", "1j", "1 jam", "1j30m", "90mnt" → menit. */
export function parseDuration(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s+/g, '')
  if (/^\d{1,4}$/.test(s)) return within(Number(s))
  const m = /^(?:(\d{1,2})(?:j|jam|h))?(?:(\d{1,4})(?:m|mnt|menit|min))?$/.exec(s)
  if (!m || (!m[1] && !m[2])) return null
  return within(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0))
}
const within = (n: number) => (Number.isInteger(n) && n >= 1 && n <= 1440 ? n : null)

/**
 * Pisahkan waktu & pesan pengingat, di mana pun letak waktunya:
 * "30m minum obat", "2 jam lagi angkat jemuran", "aku jam 4 sore jemput adik", "besok pagi bayar listrik".
 * `at` null bila waktunya tidak terbaca atau sudah lewat.
 */
export function splitReminder(arg: string, tz: string): { at: string | null; label: string; repeat: string | null } {
  // berulang: "tiap hari jam 7 minum obat", "setiap senin & kamis 06.00 olahraga", "tiap malam baca buku"
  const r = extractRepeat(arg, tz)
  if (r) {
    const w = extractWhen(r.rest, tz, { defaultTime: '08:00', part: r.part ?? undefined, timeOnly: true })
    const hhmm = w ? hhmmIn(w.iso, tz) : '08:00'
    return { at: nextOccurrence(r.repeat, hhmm, tz, new Date()), label: cleanReminderLabel(w ? w.rest : r.rest), repeat: r.repeat }
  }
  const words = arg.trim().split(/\s+/).filter(Boolean)
  // durasi di awal: "30m", "45 menit", "1 jam", "1j 30m" (boleh diikuti "lagi")
  for (const n of [2, 1]) {
    const min = words.length >= n ? parseDuration(words.slice(0, n).join(' ')) : null
    if (min) {
      const rest = words.slice(n)
      if (/^(lagi|kemudian)$/i.test(rest[0] ?? '')) rest.shift()
      return { at: new Date(Date.now() + min * 60_000).toISOString(), label: cleanReminderLabel(rest.join(' ')), repeat: null }
    }
  }
  const w = extractWhen(arg, tz, { defaultTime: '09:00', future: true })
  if (w && new Date(w.iso).getTime() > Date.now()) return { at: w.iso, label: cleanReminderLabel(w.rest), repeat: null }
  return { at: null, label: cleanReminderLabel(w ? w.rest : arg), repeat: null }
}

/** Pengingat lengkap (waktu + pesan) dari "/ingatkan …", atau null. */
export function parseReminder(arg: string, tz: string): { at: string; label: string; repeat: string | null } | null {
  const p = splitReminder(arg, tz)
  return p.at && p.label ? { at: p.at, label: p.label, repeat: p.repeat } : null
}

/** "Tiap hari 07.00" untuk pengingat berulang. */
export const repeatText = (repeat: string, iso: string, tz: string) => `${repeatLabel(repeat)} ${formatTime(iso, tz)}`

export async function createTimer(ctx: Ctx, kind: 'timer' | 'ingat', fireAt: string, label: string, minutes: number | null, repeat: string | null = null): Promise<{ error: string } | { id: string }> {
  const { count } = await ctx.db.from('bot_timers').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).is('sent_at', null)
  if ((count ?? 0) >= MAX_ACTIVE) return { error: `Maksimal ${MAX_ACTIVE} timer & pengingat aktif. Batalkan salah satu dulu.` }
  const { data, error } = await ctx.db.from('bot_timers')
    .insert({ user_id: ctx.userId, kind, label: label.trim().slice(0, 200), minutes, fire_at: fireAt, ...(repeat && kind === 'ingat' ? { repeat } : {}) }).select('id').single()
  if (error) throw error
  return { id: data.id as string }
}

const left = (iso: string) => {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
  return m < 1 ? 'kurang dari 1 menit' : `${minutesLabel(m)} lagi`
}

/** Panel "Timer & Pengingat": timer aktif, pengingat bebas, dan pengingat tugas 24 jam ke depan. */
export async function timerPanel(ctx: Ctx, notice?: string): Promise<Panel> {
  const [{ data: timers }, { data: tasks }] = await Promise.all([
    ctx.db.from('bot_timers').select('id, kind, label, minutes, fire_at, repeat').eq('user_id', ctx.userId).is('sent_at', null).order('fire_at').limit(MAX_ACTIVE),
    ctx.db.from('tasks').select('id, kind, title, due_at, start_at, remind_before_minutes')
      .eq('user_id', ctx.userId).in('status', OPEN).not('remind_before_minutes', 'is', null).is('reminded_at', null).limit(200),
  ])
  const list = timers ?? []
  const now = Date.now()
  const taskSoon = (tasks ?? []).map((t) => ({ ...t, at: t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at })).filter((t) => t.at)
    .map((t) => ({ ...t, fire: new Date(t.at!).getTime() - t.remind_before_minutes! * 60_000 }))
    .filter((t) => t.fire <= now + 86_400_000 && new Date(t.at!).getTime() > now).sort((a, b) => a.fire - b.fire).slice(0, 8)
  return {
    head: ['<b>Timer & Pengingat</b>', '<i>Rupi akan mengirim notifikasi tepat waktunya.</i>'],
    sections: [
      ...(notice ? [{ lines: [notice] }] : []),
      {
        title: `Aktif (${list.length})`,
        quote: list.length ? true : false,
        lines: list.length
          ? list.map((t, i) => `<b>${i + 1}.</b> ${t.kind === 'timer' ? `Timer ${minutesLabel(t.minutes ?? 0)}` : t.repeat ? '🔁 Ingatkan' : 'Ingatkan'}${t.label ? ` — ${cut(t.label, 36)}` : ''}\n    <i>${t.repeat ? `${repeatText(t.repeat, t.fire_at, ctx.tz)} · berikutnya ${whenLabel(t.fire_at, ctx.tz)}` : `${whenLabel(t.fire_at, ctx.tz, { bare: true })} · ${left(t.fire_at)}`}</i>`)
          : ['<i>Belum ada timer. Pilih durasi di bawah, atau kirim</i> <code>/timer 25 fokus</code>'],
      },
      {
        title: 'Pengingat tugas (24 jam)',
        lines: taskSoon.length ? taskSoon.map((t) => `• <b>${whenLabel(new Date(t.fire).toISOString(), ctx.tz, { bare: true })}</b>  ${cut(t.title, 40)}`) : ['<i>Tidak ada. Atur lewat kolom "Ingatkan" saat menambah tugas.</i>'],
      },
      { lines: ['<i>Ingatkan bebas:</i> <code>/ingatkan 30m minum obat</code> · <code>/ingatkan jam 4 sore angkat jemuran</code>', '<i>Berulang:</i> <code>/ingatkan tiap hari jam 7 minum obat</code>'] },
    ],
    kb: [
      PRESETS.map((m) => btn(`⏱ ${m} menit`, `tm:n:${m}`)).slice(0, 2),
      PRESETS.map((m) => btn(`⏱ ${m} menit`, `tm:n:${m}`)).slice(2),
      [btn('🔔 Ingatkan saya…', 'f:ingat')],
      ...rows(list.slice(0, 8).map((t, i) => btn(`✖️ Batal ${i + 1}`, `tm:x:${t.id}`)), 4),
      navRow(),
    ],
  }
}

/** Pesan saat timer / pengingat berbunyi. `next`: jadwal berikutnya bila pengingatnya berulang. */
export function firedMessage(t: { id: string; kind: string; label: string; minutes: number | null; fire_at: string; repeat?: string | null }, tz: string, next?: { id: string; at: string }): { html: string; kb: Keyboard } {
  if (t.kind === 'timer') {
    return {
      html: [`<b>Waktu habis!</b>`, `<i>Timer ${minutesLabel(t.minutes ?? 0)} selesai pukul ${formatTime(t.fire_at, tz)}</i>`, ...(t.label ? ['', `<blockquote>${esc(t.label)}</blockquote>`] : [])].join('\n'),
      kb: [[btn(`🔁 Ulangi ${minutesLabel(t.minutes ?? 25)}`, `tm:r:${t.id}`), btn('⏱ Timer lain', 'p:timer')], [btn('🏠 Menu', 'p:home')]],
    }
  }
  return {
    html: [
      '<b>Pengingat</b>', `<blockquote>${esc(t.label || 'Waktunya!')}</blockquote>`, `<i>Dijadwalkan pukul ${formatTime(t.fire_at, tz)}</i>`,
      ...(t.repeat && next ? [`🔁 <i>${repeatText(t.repeat, t.fire_at, tz)} · berikutnya ${whenLabel(next.at, tz)}</i>`] : []),
    ].join('\n'),
    kb: [
      [btn('⏰ +10 menit', `tm:z:${t.id}:10`), btn('+30 menit', `tm:z:${t.id}:30`), btn('+1 jam', `tm:z:${t.id}:60`)],
      [btn('🌅 Besok pagi', `tm:z:${t.id}:bp`), btn('✅ Oke', 'tm:ok')],
      ...(t.repeat && next ? [[btn('⏹ Hentikan pengulangan', `tm:s:${next.id}`)]] : []),
      [btn('🏠 Menu', 'p:home')],
    ],
  }
}

/** Cek sore: tugas hari ini (dan yang terlambat) yang belum selesai. null bila tidak ada. */
export async function eveningPanel(ctx: Pick<Ctx, 'db' | 'userId' | 'tz' | 'name'>, force = false): Promise<Panel | null> {
  const today = todayIn(ctx.tz)
  const end = startOfDayIso(addDays(today, 1), ctx.tz), start = startOfDayIso(today, ctx.tz)
  const { data } = await ctx.db.from('tasks').select('id, title, due_at, start_at')
    .eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN)
    .or(`due_at.lt.${end},and(due_at.is.null,start_at.gte.${start},start_at.lt.${end})`)
    .order('due_at', { ascending: true, nullsFirst: false }).limit(30)
  const list = data ?? []
  if (!list.length && !force) return null
  const first = ctx.name.split(' ')[0] || ctx.name
  const late = (t: { due_at: string | null }) => !!t.due_at && new Date(t.due_at).getTime() < new Date(start).getTime()
  return {
    head: list.length
      ? [`<b>${esc(first)}, masih ada ${list.length} tugas yang belum selesai hari ini.</b>`, '<i>Yuk selesaikan sebelum hari berakhir — ketuk nomornya bila sudah beres.</i>']
      : ['<b>Semua tugas hari ini sudah selesai.</b>', '<i>Kerja bagus, selamat beristirahat.</i>'],
    sections: list.length ? [{
      quote: true,
      lines: list.slice(0, 10).map((t, i) => `<b>${i + 1}.</b> ${cut(t.title, 42)}${t.due_at ? ` — <i>${late(t) ? `terlambat sejak ${formatShort(t.due_at, ctx.tz)}` : formatTime(t.due_at, ctx.tz)}</i>` : ''}`),
    }] : [],
    kb: [
      ...rows(list.slice(0, 9).map((t, i) => btn(`✅ ${i + 1}`, `ev:${t.id}`)), 3),
      [btn('✅ Semua tugas', 'p:tugas'), btn('🏠 Menu', 'p:home')],
    ],
  }
}
