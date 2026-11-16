import 'server-only'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatDuration, formatShort, formatTime } from '../format'
import type { Keyboard } from '../telegram'
import { parseWhen } from './flows'
import { OPEN, btn, cut, esc, navRow, rows, type Ctx, type Panel } from './ui'

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

/** Pisahkan "/ingatkan <waktu> <pesan>": waktu relatif (30m, 1 jam) atau jam/tanggal (14.30, besok 08.00). */
export function parseReminder(arg: string, tz: string): { at: string; label: string } | null {
  const words = arg.trim().split(/\s+/)
  // relatif: 1–2 kata pertama (mis. "30m", "1 jam", "1j 30m")
  for (const n of [2, 1]) {
    const head = words.slice(0, n).join(' ')
    const min = parseDuration(head)
    if (min && words.length > n) return { at: new Date(Date.now() + min * 60_000).toISOString(), label: words.slice(n).join(' ') }
  }
  // absolut: ambil kata-kata awal yang memang berbentuk waktu/tanggal (mis. "14.30", "besok 08.00", "20/11 14.30")
  const TIME_WORD = /^(hari|ini|besok|lusa|jam|pukul|tgl|tanggal|\d{1,2}[.:]\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})$/i
  let n = 0
  while (n < words.length && TIME_WORD.test(words[n]!)) n++
  if (!n || n >= words.length) return null
  const at = parseWhen(words.slice(0, n).join(' '), tz, '09:00')
  return at && new Date(at).getTime() > Date.now() ? { at, label: words.slice(n).join(' ') } : null
}

export async function createTimer(ctx: Ctx, kind: 'timer' | 'ingat', fireAt: string, label: string, minutes: number | null): Promise<{ error: string } | { id: string }> {
  const { count } = await ctx.db.from('bot_timers').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).is('sent_at', null)
  if ((count ?? 0) >= MAX_ACTIVE) return { error: `Maksimal ${MAX_ACTIVE} timer & pengingat aktif. Batalkan salah satu dulu.` }
  const { data, error } = await ctx.db.from('bot_timers')
    .insert({ user_id: ctx.userId, kind, label: label.trim().slice(0, 200), minutes, fire_at: fireAt }).select('id').single()
  if (error) throw error
  return { id: data.id as string }
}

const left = (iso: string) => {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
  return m < 1 ? 'kurang dari 1 menit' : `${formatDuration(m)} lagi`
}

/** Panel "Timer & Pengingat": timer aktif, pengingat bebas, dan pengingat tugas 24 jam ke depan. */
export async function timerPanel(ctx: Ctx, notice?: string): Promise<Panel> {
  const [{ data: timers }, { data: tasks }] = await Promise.all([
    ctx.db.from('bot_timers').select('id, kind, label, minutes, fire_at').eq('user_id', ctx.userId).is('sent_at', null).order('fire_at').limit(MAX_ACTIVE),
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
          ? list.map((t, i) => `<b>${i + 1}.</b> ${t.kind === 'timer' ? `Timer ${formatDuration(t.minutes ?? 0)}` : 'Ingatkan'}${t.label ? ` — ${cut(t.label, 36)}` : ''}\n    <i>${formatTime(t.fire_at, ctx.tz)} · ${left(t.fire_at)}</i>`)
          : ['<i>Belum ada timer. Pilih durasi di bawah, atau kirim</i> <code>/timer 25 fokus</code>'],
      },
      {
        title: 'Pengingat tugas (24 jam)',
        lines: taskSoon.length ? taskSoon.map((t) => `• <b>${formatTime(new Date(t.fire).toISOString(), ctx.tz)}</b>  ${cut(t.title, 40)}`) : ['<i>Tidak ada. Atur lewat kolom "Ingatkan" saat menambah tugas.</i>'],
      },
      { lines: ['<i>Ingatkan bebas:</i> <code>/ingatkan 30m minum obat</code> · <code>/ingatkan 14.30 rapat</code>'] },
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

/** Pesan saat timer / pengingat berbunyi. */
export function firedMessage(t: { id: string; kind: string; label: string; minutes: number | null; fire_at: string }, tz: string): { html: string; kb: Keyboard } {
  if (t.kind === 'timer') {
    return {
      html: [`<b>Waktu habis!</b>`, `<i>Timer ${formatDuration(t.minutes ?? 0)} selesai pukul ${formatTime(t.fire_at, tz)}</i>`, ...(t.label ? ['', `<blockquote>${esc(t.label)}</blockquote>`] : [])].join('\n'),
      kb: [[btn(`🔁 Ulangi ${formatDuration(t.minutes ?? 25)}`, `tm:r:${t.id}`), btn('⏱ Timer lain', 'p:timer')], [btn('🏠 Menu', 'p:home')]],
    }
  }
  return {
    html: ['<b>Pengingat</b>', `<blockquote>${esc(t.label || 'Waktunya!')}</blockquote>`, `<i>Dijadwalkan pukul ${formatTime(t.fire_at, tz)}</i>`].join('\n'),
    kb: [[btn('⏰ Tunda 10 menit', `tm:z:${t.id}`), btn('✅ Oke', 'tm:ok')], [btn('🏠 Menu', 'p:home')]],
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
