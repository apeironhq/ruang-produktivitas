'use server'

import { revalidatePath } from 'next/cache'
import { buildCardData, siteUrl, todayAgenda } from '@/lib/bot'
import { DEFAULT_TZ, addDays, isValidTimeZone, startOfDayIso, todayIn, zonedToIso } from '@/lib/dates'
import { formatDay, formatDuration, formatNumber, formatRupiah, formatShort, formatTime } from '@/lib/format'
import { GOAL_COLUMNS, mergeProgress } from '@/lib/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyInitData } from '@/lib/telegram-webapp'
import type { Goal, GoalProgressRow } from '@/lib/types'
import { goalNumbers } from '../(app)/target/GoalCard'
import type { MiniHome, MiniItem, MiniResult, MiniView, MiniViewName } from './types'

/*
 * Mini App Telegram. Tidak ada cookie sesi: setiap panggilan membawa initData yang ditandatangani
 * Telegram dengan token bot, lalu dicocokkan ke akun yang sudah ditautkan (telegram_connections).
 * Klien service role melewati RLS → SETIAP query dibatasi user_id secara eksplisit.
 */
interface Ctx { userId: string; tz: string; name: string }
const OPEN = ['belum', 'dikerjakan', 'tertunda']
const db = () => createAdminClient()

async function auth(initData: string): Promise<Ctx | null> {
  const v = verifyInitData(initData)
  if (!v) return null
  const { data: conn } = await db().from('telegram_connections').select('user_id').eq('telegram_user_id', v.telegramUserId).maybeSingle()
  if (!conn) return null
  const { data: prof } = await db().from('profiles').select('display_name, timezone').eq('id', conn.user_id).maybeSingle()
  return { userId: conn.user_id, tz: prof?.timezone && isValidTimeZone(prof.timezone) ? prof.timezone : DEFAULT_TZ, name: prof?.display_name || 'Kamu' }
}

export type HomeResult = { ok: true; home: MiniHome } | { ok: false; reason: 'tidak-valid' | 'belum-tertaut' }

export async function tgHome(initData: string): Promise<HomeResult> {
  if (!verifyInitData(initData)) return { ok: false, reason: 'tidak-valid' }
  const ctx = await auth(initData)
  if (!ctx) return { ok: false, reason: 'belum-tertaut' }
  const c = db()
  const today = todayIn(ctx.tz)
  const [card, agenda, sess, subs, reminders] = await Promise.all([
    buildCardData(c, ctx.userId, ctx.tz, ctx.name),
    todayAgenda(c, ctx.userId, ctx.tz),
    c.from('learning_sessions').select('duration_minutes').eq('user_id', ctx.userId).eq('session_date', today).limit(200),
    c.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(100),
    upcomingReminders(ctx),
  ])
  const now = Date.now()
  const items: Array<MiniItem & { at: string }> = [
    ...agenda.overdue.map((t) => ({ id: t.id, title: t.title, at: t.due_at!, time: shortDay(t.due_at!, ctx.tz, today), late: true, kind: 'tugas' as const })),
    ...agenda.events.map((e) => ({ id: e.id, title: e.title, at: e.start_at!, time: formatTime(e.start_at!, ctx.tz), late: false, kind: 'kegiatan' as const, sub: e.location || undefined })),
    ...agenda.dueToday.map((t) => {
      const at = (t.due_at ?? t.start_at)!
      return { id: t.id, title: t.title, at, time: at ? formatTime(at, ctx.tz) : '', late: !!t.due_at && new Date(t.due_at).getTime() < now, kind: 'tugas' as const }
    }),
  ]
  const ordered = [...items.filter((i) => i.late), ...items.filter((i) => !i.late).sort((a, b) => a.at.localeCompare(b.at))]
  const minutes = (sess.data ?? []).reduce((n, s) => n + s.duration_minutes, 0)
  return {
    ok: true,
    home: {
      name: card.name, greeting: card.greeting, today,
      dateLabel: new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`)),
      stats: { tasks: card.stats.tasks, sessions: card.stats.sessions, sessionMinutes: minutes ? formatDuration(minutes) : '', expense: card.stats.expense, goals: card.stats.goals },
      agenda: ordered.slice(0, 8).map((i) => ({ id: i.id, title: i.title, time: i.time, late: i.late, kind: i.kind, sub: i.sub })),
      more: Math.max(ordered.length - 8, 0),
      notifCount: reminders.length,
      siteUrl: siteUrl(),
      subjects: (subs.data ?? []) as Array<{ id: string; title: string }>,
    },
  }
}

/** Tenggat yang sudah lewat: "Kemarin" atau "15 Nov" (ringkas untuk layar HP). */
function shortDay(iso: string, tz: string, today: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
  if (day === addDays(today, -1)) return 'Kemarin'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso))
}

async function upcomingReminders(ctx: Ctx) {
  const { data } = await db().from('tasks').select('id, kind, title, due_at, start_at, remind_before_minutes')
    .eq('user_id', ctx.userId).in('status', OPEN).not('remind_before_minutes', 'is', null).is('reminded_at', null).limit(200)
  const now = Date.now()
  return (data ?? []).map((t) => ({ ...t, at: t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at }))
    .filter((t) => t.at && new Date(t.at).getTime() > now)
    .map((t) => ({ ...t, fire: new Date(t.at!).getTime() - t.remind_before_minutes! * 60_000 }))
    .filter((t) => t.fire <= now + 86_400_000).sort((a, b) => a.fire - b.fire)
}

export async function tgView(initData: string, view: MiniViewName): Promise<MiniView | null> {
  const ctx = await auth(initData)
  if (!ctx) return null
  const c = db()
  const today = todayIn(ctx.tz)

  if (view === 'tugas') {
    const { data } = await c.from('tasks').select('id, kind, title, due_at, start_at, priority, location')
      .eq('user_id', ctx.userId).in('status', OPEN).order('due_at', { ascending: true, nullsFirst: false }).limit(300)
    const startToday = new Date(startOfDayIso(today, ctx.tz)).getTime()
    const startTomorrow = new Date(startOfDayIso(addDays(today, 1), ctx.tz)).getTime()
    const now = Date.now()
    const g = { late: [] as MiniItem[], today: [] as MiniItem[], next: [] as MiniItem[], none: [] as MiniItem[] }
    const nextAt = new Map<string, number>()
    for (const t of data ?? []) {
      const at = t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at
      const ms = at ? new Date(at).getTime() : null
      const late = t.kind === 'tugas' && !!t.due_at && new Date(t.due_at).getTime() < now
      if (t.kind === 'kegiatan' && ms !== null && ms < startToday) continue // kegiatan yang sudah lewat
      const item: MiniItem = { id: t.id, title: t.title, kind: t.kind, late, time: '', sub: t.location || (t.priority === 'tinggi' || t.priority === 'mendesak' ? `Prioritas ${t.priority}` : undefined) }
      if (late && ms !== null && ms < startToday) g.late.push({ ...item, time: formatShort(at!, ctx.tz) })
      else if (ms !== null && ms < startTomorrow) { g.today.push({ ...item, time: formatTime(at!, ctx.tz) }); nextAt.set(t.id, ms) }
      else if (ms !== null) { g.next.push({ ...item, time: formatShort(at!, ctx.tz) }); nextAt.set(t.id, ms) }
      else g.none.push(item)
    }
    return {
      view: 'tugas',
      groups: [
        { title: 'Terlambat', tone: 'late' as const, items: g.late },
        { title: 'Hari ini', items: g.today.sort((a, b) => nextAt.get(a.id)! - nextAt.get(b.id)!) },
        { title: 'Mendatang', items: g.next.sort((a, b) => nextAt.get(a.id)! - nextAt.get(b.id)!).slice(0, 30) },
        { title: 'Tanpa tanggal', items: g.none.slice(0, 30) },
      ].filter((x) => x.items.length),
    }
  }

  if (view === 'belajar') {
    const from = addDays(today, -6)
    const [subs, sess] = await Promise.all([
      c.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(50),
      c.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', ctx.userId).gte('session_date', addDays(today, -60)).order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    ])
    const name = new Map((subs.data ?? []).map((s) => [s.id, s.title]))
    const week = (sess.data ?? []).filter((s) => s.session_date >= from)
    const per = new Map<string, number>()
    for (const s of week) per.set(s.subject_id, (per.get(s.subject_id) ?? 0) + s.duration_minutes)
    const total = [...per.values()].reduce((a, b) => a + b, 0)
    const max = Math.max(1, ...per.values())
    return {
      view: 'belajar', total: formatDuration(total), count: week.length,
      subjects: (subs.data ?? []).map((s) => ({ id: s.id, title: s.title, minutes: formatDuration(per.get(s.id) ?? 0), pct: Math.round(((per.get(s.id) ?? 0) / max) * 100) })),
      recent: (sess.data ?? []).slice(0, 8).map((s) => ({ title: s.material || name.get(s.subject_id) || 'Sesi belajar', sub: `${name.get(s.subject_id) ?? 'Bidang'} · ${formatDay(s.session_date)}`, right: formatDuration(s.duration_minutes) })),
    }
  }

  if (view === 'target') {
    const { data } = await c.from('goals').select(GOAL_COLUMNS).eq('user_id', ctx.userId).eq('status', 'aktif').order('created_at', { ascending: false }).limit(30)
    const goals = (data ?? []) as Goal[]
    const { data: prog } = goals.length
      ? await c.from('goal_progress').select('goal_id, current_value, effective_target, effective_start, item_total, item_done').in('goal_id', goals.map((g) => g.id))
      : { data: [] }
    return {
      view: 'target',
      goals: mergeProgress(goals, (prog ?? []) as GoalProgressRow[]).map((g) => ({
        id: g.id, title: g.title, percent: g.percent, sub: goalNumbers(g).summary, due: g.due_date ? `Tenggat ${formatDay(g.due_date)}` : '',
      })),
    }
  }

  if (view === 'uang') {
    const monthStart = `${today.slice(0, 7)}-01`
    const [tx, cats, recent] = await Promise.all([
      c.from('transactions').select('type, amount, category_id, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', monthStart).limit(5000),
      c.from('transaction_categories').select('id, name').eq('user_id', ctx.userId),
      c.from('transactions').select('type, amount, category_id, occurred_on, note').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(8),
    ])
    const cat = new Map((cats.data ?? []).map((x) => [x.id, x.name]))
    let inc = 0, exp = 0, todayExp = 0
    const by = new Map<string, number>()
    for (const t of tx.data ?? []) {
      const a = Number(t.amount)
      if (t.type === 'pemasukan') inc += a
      else { exp += a; if (t.occurred_on === today) todayExp += a; by.set(t.category_id ?? '-', (by.get(t.category_id ?? '-') ?? 0) + a) }
    }
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    return {
      view: 'uang',
      month: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00Z`)),
      income: formatRupiah(inc), expense: formatRupiah(exp), diff: formatRupiah(Math.abs(inc - exp)), diffNeg: inc - exp < 0, today: formatRupiah(todayExp),
      top: top.map(([k, v]) => ({ name: cat.get(k) ?? 'Tanpa kategori', amount: formatRupiah(v), pct: exp ? Math.round((v / exp) * 100) : 0 })),
      recent: (recent.data ?? []).map((t) => ({
        title: t.note || cat.get(t.category_id ?? '') || (t.type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'),
        sub: `${cat.get(t.category_id ?? '') ?? 'Tanpa kategori'} · ${formatDay(t.occurred_on)}`,
        amount: `${t.type === 'pemasukan' ? '+' : '−'}${formatRupiah(t.amount)}`, income: t.type === 'pemasukan',
      })),
    }
  }

  if (view === 'ringkasan') {
    const cur = addDays(today, -6), prev = addDays(today, -13)
    const curIso = startOfDayIso(cur, ctx.tz)
    const [done, sess, notes, checks] = await Promise.all([
      c.from('tasks').select('completed_at').eq('user_id', ctx.userId).gte('completed_at', startOfDayIso(prev, ctx.tz)).limit(5000),
      c.from('learning_sessions').select('session_date, duration_minutes').eq('user_id', ctx.userId).gte('session_date', prev).limit(5000),
      c.from('journal_entries').select('entry_date').eq('user_id', ctx.userId).gte('entry_date', prev).limit(5000),
      c.from('habit_checkins').select('checkin_date').eq('user_id', ctx.userId).gte('checkin_date', prev).limit(10000),
    ])
    const split = <T,>(rows: T[] | null, isCur: (r: T) => boolean, w: (r: T) => number = () => 1) => {
      let a = 0, b = 0
      for (const r of rows ?? []) { if (isCur(r)) a += w(r); else b += w(r) }
      return [a, b] as const
    }
    const row = (label: string, [a, b]: readonly [number, number], fmt: (n: number) => string = formatNumber) =>
      ({ label, cur: fmt(a), prev: fmt(b), trend: a > b ? 'up' as const : a < b ? 'down' as const : 'flat' as const })
    return {
      view: 'ringkasan',
      rows: [
        row('Tugas selesai', split(done.data, (r) => r.completed_at! >= curIso)),
        row('Waktu belajar', split(sess.data, (r) => r.session_date >= cur, (r) => r.duration_minutes), formatDuration),
        row('Catatan ditulis', split(notes.data, (r) => r.entry_date >= cur)),
        row('Check-in kebiasaan', split(checks.data, (r) => r.checkin_date >= cur)),
      ],
    }
  }

  // notif
  const [up, logs] = await Promise.all([
    upcomingReminders(ctx),
    c.from('reminder_logs').select('kind, status, detail, created_at, task_id').eq('user_id', ctx.userId).order('created_at', { ascending: false }).limit(15),
  ])
  const ids = [...new Set((logs.data ?? []).map((l) => l.task_id).filter(Boolean))] as string[]
  const { data: titles } = ids.length ? await c.from('tasks').select('id, title').eq('user_id', ctx.userId).in('id', ids) : { data: [] }
  const title = new Map((titles ?? []).map((t) => [t.id, t.title]))
  const rel = (ms: number) => { const m = Math.round((ms - Date.now()) / 60000); return m <= 0 ? 'sebentar lagi' : m < 60 ? `${m} menit lagi` : `${formatDuration(m)} lagi` }
  return {
    view: 'notif',
    upcoming: up.slice(0, 15).map((t) => ({ title: t.title, sub: `${t.kind === 'kegiatan' ? 'Mulai' : 'Tenggat'} ${formatShort(t.at!, ctx.tz)}`, right: rel(t.fire) })),
    recent: (logs.data ?? []).map((l) => ({
      title: l.kind === 'ringkasan' ? 'Ringkasan harian' : title.get(l.task_id ?? '') ?? 'Pengingat tugas',
      sub: `${formatShort(l.created_at, ctx.tz)}${l.status === 'gagal' && l.detail ? ` · ${l.detail}` : ''}`,
      status: l.status as 'terkirim' | 'gagal' | 'dilewati',
    })),
  }
}

/* ---------- Aksi ---------- */
const fail = (message: string): MiniResult => ({ ok: false, message })
function refresh() { revalidatePath('/', 'layout') }

export async function tgToggleTask(initData: string, id: string, done: boolean): Promise<MiniResult> {
  const ctx = await auth(initData)
  if (!ctx) return fail('Sesi tidak valid. Tutup lalu buka lagi Rupi.')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Data tidak valid.')
  const { data, error } = await db().from('tasks').update({ status: done ? 'selesai' : 'belum' }).eq('id', id).eq('user_id', ctx.userId).eq('kind', 'tugas').select('recurrence').maybeSingle()
  if (error || !data) return fail('Gagal menyimpan. Coba lagi.')
  refresh()
  return { ok: true, message: done ? (data.recurrence !== 'tidak' ? 'Selesai! Jadwal berikutnya sudah dibuat.' : 'Tugas selesai 🎉') : 'Tugas dibuka lagi.' }
}

export async function tgAddNote(initData: string, title: string, content: string): Promise<MiniResult> {
  const ctx = await auth(initData)
  if (!ctx) return fail('Sesi tidak valid. Tutup lalu buka lagi Rupi.')
  const t = title.trim().slice(0, 200), body = content.trim().slice(0, 50000)
  if (!t && !body) return fail('Isi judul atau catatannya dulu.')
  const { error } = await db().from('journal_entries').insert({ user_id: ctx.userId, kind: 'catatan', title: t, content: body, entry_date: todayIn(ctx.tz), tags: ['telegram'] })
  if (error) return fail('Gagal menyimpan catatan.')
  refresh()
  return { ok: true, message: 'Catatan tersimpan.' }
}

export async function tgAddTask(initData: string, title: string, dueLocal: string, remind: string): Promise<MiniResult> {
  const ctx = await auth(initData)
  if (!ctx) return fail('Sesi tidak valid. Tutup lalu buka lagi Rupi.')
  const t = title.trim().slice(0, 200)
  if (!t) return fail('Judul tugas wajib diisi.')
  const due = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueLocal) ? zonedToIso(dueLocal, ctx.tz) : null
  const rem = remind === '' ? null : Number(remind)
  if (rem !== null && (!Number.isInteger(rem) || rem < 0 || rem > 10080)) return fail('Pilihan pengingat tidak valid.')
  if (rem !== null && !due) return fail('Isi tenggat agar bisa diingatkan.')
  const { error } = await db().from('tasks').insert({ user_id: ctx.userId, kind: 'tugas', title: t, due_at: due, remind_before_minutes: rem })
  if (error) return fail('Gagal menambah tugas.')
  refresh()
  return { ok: true, message: 'Tugas ditambahkan.' }
}

export async function tgAddSession(initData: string, subjectId: string, minutes: number, material: string): Promise<MiniResult> {
  const ctx = await auth(initData)
  if (!ctx) return fail('Sesi tidak valid. Tutup lalu buka lagi Rupi.')
  if (!/^[0-9a-f-]{36}$/i.test(subjectId)) return fail('Pilih bidang belajar.')
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return fail('Durasi harus 1–1440 menit.')
  // FK komposit (subject_id, user_id) menjamin bidang milik pengguna sendiri.
  const { error } = await db().from('learning_sessions').insert({ user_id: ctx.userId, subject_id: subjectId, session_date: todayIn(ctx.tz), duration_minutes: minutes, material: material.trim().slice(0, 200) })
  if (error) return fail('Gagal menyimpan sesi belajar.')
  refresh()
  return { ok: true, message: 'Sesi belajar tercatat.' }
}
