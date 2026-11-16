import 'server-only'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatDay, formatDuration, formatNumber, formatRupiah, formatShort, formatTime } from '../format'
import { habitStats } from '../habits'
import { JOURNAL_KIND, MOOD, PRIORITY, PROJECT_STATUS, RECURRENCE, TASK_STATUS, remindLabel } from '../labels'
import { projectProgress } from '../projects'
import { GOAL_COLUMNS, mergeProgress } from '../queries'
import type { Goal, GoalProgressRow } from '../types'
import { goalNumbers } from '../../app/(app)/target/GoalCard'
import type { Keyboard } from '../telegram'
import { OPEN, type Section, bar, btn, cut, dayOf, esc, greetingFor, link, longDay, mainKeyboard, navRow, rows, shortDay, type Ctx, type Panel } from './ui'

/*
 * Gaya pesan: judul kartu tebal (satu ikon), isi kartu utama dalam kutipan, data berpasangan
 * dalam tabel monospace (titik dua sejajar), daftar tanpa ikon per baris supaya tidak ramai.
 */
const anchorOf = (t: { kind: string; due_at: string | null; start_at: string | null }) => (t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at)
/** Teks polos untuk sel tabel (tanpa HTML; di-escape oleh tabel). */
const plain = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/* ================= Beranda ================= */
export async function todayAgenda(ctx: Pick<Ctx, 'db' | 'userId' | 'tz'>) {
  const today = todayIn(ctx.tz)
  const from = startOfDayIso(today, ctx.tz)
  const to = startOfDayIso(addDays(today, 1), ctx.tz)
  const [overdue, dueToday, events] = await Promise.all([
    ctx.db.from('tasks').select('id, title, due_at').eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN).lt('due_at', from).order('due_at').limit(10),
    ctx.db.from('tasks').select('id, title, due_at, start_at').eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN)
      .or(`and(due_at.gte.${from},due_at.lt.${to}),and(due_at.is.null,start_at.gte.${from},start_at.lt.${to})`).order('due_at').limit(15),
    ctx.db.from('tasks').select('id, title, start_at, end_at, location').eq('user_id', ctx.userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan')
      .gte('start_at', from).lt('start_at', to).order('start_at').limit(15),
  ])
  return { today, overdue: overdue.data ?? [], dueToday: dueToday.data ?? [], events: events.data ?? [] }
}

export async function homePanel(ctx: Pick<Ctx, 'db' | 'userId' | 'tz' | 'name'>, note?: string): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const [a, tasks, sess, spend, goals, habits, checks] = await Promise.all([
    todayAgenda(ctx),
    ctx.db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN),
    ctx.db.from('learning_sessions').select('duration_minutes').eq('user_id', ctx.userId).eq('session_date', today).limit(200),
    ctx.db.from('transactions').select('amount').eq('user_id', ctx.userId).eq('type', 'pengeluaran').eq('occurred_on', today).limit(1000),
    ctx.db.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'aktif'),
    ctx.db.from('habits').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('is_archived', false).eq('frequency', 'harian'),
    ctx.db.from('habit_checkins').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('checkin_date', today),
  ])
  const now = Date.now()
  const late = [
    ...a.overdue.map((t) => `• ${cut(t.title, 46)} — <i>${formatShort(t.due_at!, ctx.tz)}</i>`),
    ...a.dueToday.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).map((t) => `• ${cut(t.title, 46)} — <i>${formatTime(t.due_at!, ctx.tz)}</i>`),
  ]
  const rest = [
    ...a.events.map((e) => ({ at: e.start_at!, line: `• <b>${formatTime(e.start_at!, ctx.tz)}</b>  ${cut(e.title, 42)}${e.location ? ` <i>· ${cut(e.location, 20)}</i>` : ''}` })),
    ...a.dueToday.filter((t) => !(t.due_at && new Date(t.due_at).getTime() < now)).map((t) => {
      const at = (t.due_at ?? t.start_at)!
      return { at, line: `• <b>${formatTime(at, ctx.tz)}</b>  ${cut(t.title, 42)}` }
    }),
  ].sort((x, y) => x.at.localeCompare(y.at)).map((x) => x.line)
  const agenda = [
    ...(late.length ? [`⚠️ <b>${late.length} tugas terlambat</b>`, ...late.slice(0, 4), ...(late.length > 4 ? [`<i>+${late.length - 4} lainnya</i>`] : [])] : []),
    ...(late.length && rest.length ? [''] : []),
    ...rest,
  ]
  const sessions = sess.data ?? []
  const minutes = sessions.reduce((n, s) => n + s.duration_minutes, 0)
  const expense = (spend.data ?? []).reduce((n, r) => n + Number(r.amount), 0)
  const first = ctx.name.split(' ')[0] || ctx.name
  return {
    head: [`<b>${greetingFor(ctx.tz)}, ${esc(first)}!</b> 👋`, `<i>${longDay(today)}</i>`],
    sections: [
      { title: '📅 Agenda Hari Ini', lines: agenda.length ? agenda : ['Tidak ada tugas atau kegiatan hari ini.'], quote: true },
      {
        title: '📊 Ringkasan', lines: [],
        table: [
          ['Tugas aktif', String(tasks.count ?? 0)],
          ['Belajar', `${sessions.length} sesi${minutes ? ` · ${formatDuration(minutes)}` : ''}`],
          ['Pengeluaran', formatRupiah(expense)],
          ['Target aktif', String(goals.count ?? 0)],
          ...(habits.count ? [['Kebiasaan', `${Math.min(checks.count ?? 0, habits.count)}/${habits.count} selesai`] as [string, string]] : []),
        ],
      },
      ...(note ? [{ lines: [note] }] : []),
    ],
    foot: ['<b>Apa yang ingin kamu lakukan?</b>', '<i>Pilih menu di bawah ini 👇</i>'],
    kb: mainKeyboard(),
  }
}

/* ================= Catat cepat ================= */
export function catatPanel(): Panel {
  return {
    head: ['📝 <b>Catat Cepat</b>', '<i>Mau mencatat apa?</i>'],
    sections: [{ lines: ['<i>Tips: kirim pesan apa saja ke Rupi, lalu pilih simpan sebagai catatan atau tugas.</i>'] }],
    kb: [
      [btn('✅ Tugas', 'f:tugas'), btn('📅 Kegiatan', 'f:kegiatan')],
      [btn('🗒 Catatan / Jurnal', 'f:catatan'), btn('📚 Sesi belajar', 'f:sesi')],
      [btn('💸 Pengeluaran', 'f:keluar'), btn('💵 Pemasukan', 'f:masuk')],
      navRow(),
    ],
  }
}

/* ================= Tugas & Kegiatan ================= */
export async function tasksPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const startToday = new Date(startOfDayIso(today, ctx.tz)).getTime()
  const startTomorrow = new Date(startOfDayIso(addDays(today, 1), ctx.tz)).getTime()
  const { data } = await ctx.db.from('tasks').select('id, kind, title, due_at, start_at, priority')
    .eq('user_id', ctx.userId).in('status', OPEN).limit(300)
  const now = Date.now()
  type It = { id: string; title: string; ms: number; when: string; tag: string }
  const late: It[] = [], todayL: It[] = [], next: It[] = [], none: It[] = []
  for (const t of data ?? []) {
    const at = anchorOf(t)
    const ms = at ? new Date(at).getTime() : Infinity
    if (t.kind === 'kegiatan' && ms < startToday) continue
    const tag = t.kind === 'kegiatan' ? ' <i>· kegiatan</i>' : t.priority === 'mendesak' ? ' <i>· mendesak</i>' : ''
    if (t.kind === 'tugas' && t.due_at && new Date(t.due_at).getTime() < now) late.push({ id: t.id, title: t.title, ms, when: formatShort(t.due_at, ctx.tz), tag })
    else if (ms < startTomorrow) todayL.push({ id: t.id, title: t.title, ms, when: formatTime(at!, ctx.tz), tag })
    else if (ms !== Infinity) next.push({ id: t.id, title: t.title, ms, when: formatShort(at!, ctx.tz), tag })
    else none.push({ id: t.id, title: t.title, ms, when: '', tag })
  }
  for (const g of [late, todayL, next]) g.sort((a, b) => a.ms - b.ms)
  // Nomor urut dipakai bersama oleh daftar teks & tombol (maks. 10 tombol).
  const numbered = [...late, ...todayL, ...next, ...none].slice(0, 10)
  const num = new Map(numbered.map((x, i) => [x.id, i + 1]))
  const line = (x: It) => `<b>${num.get(x.id) ? `${num.get(x.id)}.` : '•'}</b> ${cut(x.title, 40)}${x.when ? ` — <i>${x.when}</i>` : ''}${x.tag}`
  const total = late.length + todayL.length + next.length + none.length
  return {
    head: ['✅ <b>Tugas & Kegiatan</b>', `<i>${total} belum selesai · ketuk nomor untuk membuka</i>`],
    sections: total ? [
      { title: `⚠️ Terlambat (${late.length})`, lines: late.map(line), quote: true as Section['quote'] },
      { title: `Hari ini (${todayL.length})`, lines: todayL.map(line), quote: true as Section['quote'] },
      { title: `Mendatang (${next.length})`, lines: next.map(line), quote: (next.length > 4 ? 'expand' : true) as Section['quote'] },
      { title: `Tanpa tanggal (${none.length})`, lines: none.map(line), quote: 'expand' as Section['quote'] },
    ].filter((s) => s.lines.length) : [{ lines: ['Semua tugas beres. Mantap! 🎉'], quote: true }],
    kb: [
      ...rows(numbered.map((x) => btn(String(num.get(x.id)), `td:${x.id}`)), 5),
      [btn('➕ Tugas', 'f:tugas'), btn('➕ Kegiatan', 'f:kegiatan')],
      navRow('p:home', '/tugas'),
    ],
  }
}

export async function taskDetailPanel(ctx: Ctx, id: string): Promise<Panel | null> {
  const [{ data: t }, { data: subs }] = await Promise.all([
    ctx.db.from('tasks').select('id, kind, title, description, category, priority, status, due_at, start_at, end_at, location, recurrence, remind_before_minutes, project_id, goal_id')
      .eq('id', id).eq('user_id', ctx.userId).maybeSingle(),
    ctx.db.from('task_subtasks').select('id, title, is_completed').eq('task_id', id).eq('user_id', ctx.userId).order('sort_order').order('created_at').limit(30),
  ])
  if (!t) return null
  const [proj, goal] = await Promise.all([
    t.project_id ? ctx.db.from('projects').select('title').eq('id', t.project_id).eq('user_id', ctx.userId).maybeSingle() : Promise.resolve({ data: null }),
    t.goal_id ? ctx.db.from('goals').select('title').eq('id', t.goal_id).eq('user_id', ctx.userId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const isTask = t.kind === 'tugas'
  const late = isTask && t.due_at && new Date(t.due_at).getTime() < Date.now() && OPEN.includes(t.status)
  const info: Array<[string, string]> = [
    ['Status', `${TASK_STATUS[t.status]?.label ?? t.status}${late ? ' (terlambat)' : ''}`],
    isTask
      ? ['Tenggat', t.due_at ? formatShort(t.due_at, ctx.tz) : '—']
      : ['Jadwal', `${t.start_at ? formatShort(t.start_at, ctx.tz) : '—'}${t.end_at ? `–${formatTime(t.end_at, ctx.tz)}` : ''}`],
    ...(t.location ? [['Lokasi', plain(t.location)] as [string, string]] : []),
    ...(isTask ? [['Prioritas', PRIORITY[t.priority]?.label ?? t.priority] as [string, string]] : []),
    ...(t.category ? [['Kategori', plain(t.category)] as [string, string]] : []),
    ...(t.recurrence !== 'tidak' ? [['Ulangi', RECURRENCE[t.recurrence]?.label ?? ''] as [string, string]] : []),
    ...(t.remind_before_minutes !== null ? [['Pengingat', remindLabel(t.remind_before_minutes) ?? ''] as [string, string]] : []),
    ...(proj.data ? [['Proyek', plain(proj.data.title)] as [string, string]] : []),
    ...(goal.data ? [['Target', plain(goal.data.title)] as [string, string]] : []),
  ]
  const sub = subs ?? []
  const done = sub.filter((s) => s.is_completed).length
  const statusBtns: Keyboard = isTask
    ? [[
      ...(t.status !== 'selesai' ? [btn('✅ Selesai', `ts:s:${id}`, 'success')] : [btn('↩️ Buka lagi', `ts:b:${id}`)]),
      ...(t.status !== 'dikerjakan' && t.status !== 'selesai' ? [btn('▶️ Kerjakan', `ts:k:${id}`)] : []),
      ...(t.status !== 'tertunda' && t.status !== 'selesai' ? [btn('⏸ Tunda', `ts:t:${id}`)] : []),
    ]]
    : [[...(t.status !== 'selesai' ? [btn('✅ Sudah terlaksana', `ts:s:${id}`, 'success')] : []), ...(t.status !== 'dibatalkan' ? [btn('✖️ Batalkan', `ts:x:${id}`)] : [btn('↩️ Aktifkan', `ts:b:${id}`)])]]
  return {
    head: [`<b>${esc(t.title)}</b>`, `<i>${isTask ? 'Tugas' : 'Kegiatan'}</i>`],
    sections: [
      { title: '📋 Detail', lines: [], table: info },
      ...(isTask ? [{ title: `☑️ Subtugas (${done}/${sub.length})`, lines: sub.length ? sub.map((s, i) => `${s.is_completed ? '✅' : '⬜'} ${i + 1}. ${s.is_completed ? `<s>${cut(s.title, 50)}</s>` : cut(s.title, 50)}`) : ['<i>Belum ada subtugas.</i>'], quote: sub.length > 6 ? 'expand' as const : false }] : []),
      ...(t.description ? [{ title: '📝 Deskripsi', lines: [cut(t.description, 600)], quote: 'expand' as const }] : []),
    ],
    kb: [
      ...statusBtns,
      ...(isTask && sub.length ? rows(sub.slice(0, 8).map((s, i) => btn(`${s.is_completed ? '✅' : '⬜'} ${i + 1}`, `sx:${s.id}`)), 4) : []),
      ...(isTask ? [[btn('➕ Subtugas', `f:sub:${id}`)]] : []),
      navRow('p:tugas', `/tugas/${id}`, '⬅️ Tugas'),
    ],
  }
}

/* ================= Kalender 7 hari ================= */
export async function calendarPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const from = startOfDayIso(today, ctx.tz), to = startOfDayIso(addDays(today, 7), ctx.tz)
  const [due, ev] = await Promise.all([
    ctx.db.from('tasks').select('title, due_at, status').eq('user_id', ctx.userId).eq('kind', 'tugas').neq('status', 'dibatalkan').gte('due_at', from).lt('due_at', to).limit(200),
    ctx.db.from('tasks').select('title, start_at, end_at, status').eq('user_id', ctx.userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan').gte('start_at', from).lt('start_at', to).limit(200),
  ])
  const byDay = new Map<string, Array<{ at: string; line: string }>>()
  const add = (iso: string, line: string) => { const d = dayOf(iso, ctx.tz); byDay.set(d, [...(byDay.get(d) ?? []), { at: iso, line }]) }
  for (const t of due.data ?? []) add(t.due_at!, `• <b>${formatTime(t.due_at!, ctx.tz)}</b>  ${t.status === 'selesai' ? `<s>${cut(t.title, 40)}</s>` : cut(t.title, 40)}`)
  for (const e of ev.data ?? []) add(e.start_at!, `• <b>${formatTime(e.start_at!, ctx.tz)}${e.end_at ? `–${formatTime(e.end_at, ctx.tz)}` : ''}</b>  ${cut(e.title, 34)} <i>· kegiatan</i>`)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const sections = days.filter((d) => byDay.has(d)).map((d) => ({
    title: `${d === today ? 'Hari ini · ' : d === addDays(today, 1) ? 'Besok · ' : ''}${shortDay(d)}`,
    lines: byDay.get(d)!.sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.line),
  }))
  return {
    head: ['📅 <b>Kalender</b>', `<i>7 hari ke depan · ${shortDay(today)} – ${shortDay(addDays(today, 6))}</i>`],
    sections: sections.length ? sections : [{ lines: ['<i>Tidak ada tenggat atau kegiatan dalam 7 hari ke depan.</i>'] }],
    kb: [[btn('➕ Kegiatan', 'f:kegiatan'), btn('➕ Tugas', 'f:tugas')], navRow('p:home', '/kalender')],
  }
}

/* ================= Proyek ================= */
export async function projectsPanel(ctx: Ctx): Promise<Panel> {
  const [{ data: projects }, { data: tasks }, { data: ms }] = await Promise.all([
    ctx.db.from('projects').select('id, title, status, due_date').eq('user_id', ctx.userId).in('status', ['aktif', 'rencana', 'ditunda']).order('due_date', { ascending: true, nullsFirst: false }).limit(10),
    ctx.db.from('tasks').select('project_id, status').eq('user_id', ctx.userId).not('project_id', 'is', null).neq('status', 'dibatalkan').limit(5000),
    ctx.db.from('project_milestones').select('project_id, completed_at').eq('user_id', ctx.userId).limit(5000),
  ])
  const list = projects ?? []
  const prog = (id: string) => projectProgress(
    { done: (tasks ?? []).filter((t) => t.project_id === id && t.status === 'selesai').length, total: (tasks ?? []).filter((t) => t.project_id === id).length },
    { done: (ms ?? []).filter((m) => m.project_id === id && m.completed_at).length, total: (ms ?? []).filter((m) => m.project_id === id).length },
  )
  return {
    head: ['📁 <b>Proyek Saya</b>', `<i>${list.length} proyek berjalan · ketuk nomor untuk membuka</i>`],
    sections: list.length ? list.map((p, i) => {
      const g = prog(p.id)
      return {
        title: `${i + 1}. ${cut(p.title, 40)}`,
        lines: [`${bar(g.pct)} <b>${Math.floor(g.pct)}%</b>`, `<i>${PROJECT_STATUS[p.status]?.label ?? p.status} · ${g.label}${p.due_date ? ` · tenggat ${formatDay(p.due_date)}` : ''}</i>`],
      }
    }) : [{ lines: ['<i>Belum ada proyek aktif.</i>'] }],
    kb: [...rows(list.map((p, i) => btn(String(i + 1), `pj:${p.id}`)), 5), navRow('p:home', '/proyek')],
  }
}

export async function projectDetailPanel(ctx: Ctx, id: string): Promise<Panel | null> {
  const [{ data: p }, { data: tasks }, { data: ms }] = await Promise.all([
    ctx.db.from('projects').select('id, title, description, status, start_date, due_date').eq('id', id).eq('user_id', ctx.userId).maybeSingle(),
    ctx.db.from('tasks').select('id, title, status, due_at').eq('user_id', ctx.userId).eq('project_id', id).neq('status', 'dibatalkan').order('due_at', { ascending: true, nullsFirst: false }).limit(100),
    ctx.db.from('project_milestones').select('id, title, due_date, completed_at').eq('user_id', ctx.userId).eq('project_id', id).order('sort_order').limit(30),
  ])
  if (!p) return null
  const t = tasks ?? [], m = ms ?? []
  const g = projectProgress({ done: t.filter((x) => x.status === 'selesai').length, total: t.length }, { done: m.filter((x) => x.completed_at).length, total: m.length })
  const open = t.filter((x) => x.status !== 'selesai')
  return {
    head: [`📁 <b>${esc(p.title)}</b>`, `<i>${PROJECT_STATUS[p.status]?.label ?? p.status}${p.due_date ? ` · tenggat ${formatDay(p.due_date)}` : ''}</i>`],
    sections: [
      { title: 'Progres', lines: [`${bar(g.pct)} <b>${Math.floor(g.pct)}%</b>`, `<i>${g.label}</i>`], quote: true },
      { title: `Tahapan (${m.filter((x) => x.completed_at).length}/${m.length})`, lines: m.length ? m.map((x, i) => `${x.completed_at ? '✅' : '⬜'} ${i + 1}. ${cut(x.title, 44)}${x.due_date ? ` <i>· ${formatDay(x.due_date)}</i>` : ''}`) : ['<i>Belum ada tahapan.</i>'] },
      { title: `Tugas terbuka (${open.length})`, lines: open.length ? open.map((x) => `• ${cut(x.title, 44)}${x.due_at ? ` — <i>${formatShort(x.due_at, ctx.tz)}</i>` : ''}`) : ['<i>Tidak ada tugas terbuka.</i>'], quote: open.length > 5 ? 'expand' : false },
      ...(p.description ? [{ title: 'Deskripsi', lines: [cut(p.description, 500)], quote: 'expand' as const }] : []),
    ],
    kb: [
      ...(m.length ? rows(m.slice(0, 8).map((x, i) => btn(`${x.completed_at ? '✅' : '⬜'} ${i + 1}`, `ms:${x.id}`)), 4) : []),
      [btn('➕ Tugas proyek', `f:tp:${id}`)],
      navRow('p:proyek', `/proyek/${id}`, '⬅️ Proyek'),
    ],
  }
}

/* ================= Target ================= */
async function loadGoals(ctx: Ctx, ids?: string[]) {
  let q = ctx.db.from('goals').select(GOAL_COLUMNS).eq('user_id', ctx.userId)
  q = ids ? q.in('id', ids) : q.eq('status', 'aktif').order('created_at', { ascending: false }).limit(10)
  const { data } = await q
  const goals = (data ?? []) as Goal[]
  if (!goals.length) return []
  // goal_progress = security_invoker; service role melewati RLS → batasi ke id milik pengguna.
  const { data: prog } = await ctx.db.from('goal_progress').select('goal_id, current_value, effective_target, effective_start, item_total, item_done').in('goal_id', goals.map((g) => g.id))
  return mergeProgress(goals, (prog ?? []) as GoalProgressRow[])
}

export async function goalsPanel(ctx: Ctx): Promise<Panel> {
  const goals = await loadGoals(ctx)
  return {
    head: ['🎯 <b>Target Saya</b>', `<i>${goals.length} target berjalan · ketuk nomor untuk membuka</i>`],
    sections: goals.length ? goals.map((g, i) => ({
      title: `${i + 1}. ${cut(g.title, 40)}`,
      lines: [`${bar(g.percent)} <b>${g.percent}%</b>`, `<i>${goalNumbers(g).summary}${g.due_date ? ` · tenggat ${formatDay(g.due_date)}` : ''}</i>`],
    })) : [{ lines: ['<i>Belum ada target aktif.</i>'] }],
    kb: [...rows(goals.map((g, i) => btn(String(i + 1), `gl:${g.id}`)), 5), navRow('p:home', '/target')],
  }
}

export async function goalDetailPanel(ctx: Ctx, id: string): Promise<Panel | null> {
  const [g] = await loadGoals(ctx, [id])
  if (!g) return null
  const [{ data: ms }, { data: ev }] = await Promise.all([
    ctx.db.from('goal_milestones').select('title, threshold, reached_at').eq('goal_id', id).eq('user_id', ctx.userId).order('threshold').limit(20),
    ctx.db.from('goal_progress_events').select('value, note, occurred_on').eq('goal_id', id).eq('user_id', ctx.userId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(5),
  ])
  const n = goalNumbers(g)
  const manual = g.progress_source === 'manual'
  return {
    head: [`🎯 <b>${esc(g.title)}</b>`, `<i>${g.status === 'tercapai' ? 'Tercapai 🏆' : 'Sedang berjalan'}${g.due_date ? ` · tenggat ${formatDay(g.due_date)}` : ''}</i>`],
    sections: [
      { title: 'Progres', lines: [`${bar(g.percent)} <b>${g.percent}%</b>`], quote: true },
      { lines: [], table: [['Saat ini', n.current], ['Target', n.target], ['Sisa', n.remaining]] },
      ...((ms ?? []).length ? [{ title: 'Tahapan', lines: (ms ?? []).map((m) => `${m.reached_at ? '✅' : '⬜'} ${esc(m.title || `Ambang ${formatNumber(m.threshold)}`)}`) }] : []),
      ...(manual && (ev ?? []).length ? [{ title: 'Kontribusi terakhir', lines: [], table: (ev ?? []).map((e) => [formatDay(e.occurred_on), `${Number(e.value) > 0 ? '+' : ''}${formatNumber(e.value)}${e.note ? `  ${plain(e.note, 16)}` : ''}`] as [string, string]) }] : []),
      ...(!manual ? [{ lines: [`<i>Progres dihitung otomatis dari ${g.progress_source === 'modul' ? 'modul belajar' : g.progress_source === 'tugas' ? 'tugas tertaut' : 'alokasi tabungan'}.</i>`] }] : []),
    ],
    kb: [...(manual && g.status === 'aktif' ? [[btn('➕ Tambah progres', `f:prog:${id}`)]] : []), navRow('p:target', `/target/${id}`, '⬅️ Target')],
  }
}

/* ================= Keuangan ================= */
export async function financePanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const monthStart = `${today.slice(0, 7)}-01`
  const [tx, cats, accts, bal, recent] = await Promise.all([
    ctx.db.from('transactions').select('type, amount, category_id, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', monthStart).limit(5000),
    ctx.db.from('transaction_categories').select('id, name').eq('user_id', ctx.userId),
    ctx.db.from('financial_accounts').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).order('name'),
    ctx.db.from('account_balances').select('account_id, balance').eq('user_id', ctx.userId),
    ctx.db.from('transactions').select('type, amount, category_id, occurred_on, note').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(6),
  ])
  const cat = new Map((cats.data ?? []).map((c) => [c.id, c.name]))
  let inc = 0, exp = 0, expToday = 0
  const by = new Map<string, number>()
  for (const t of tx.data ?? []) {
    const a = Number(t.amount)
    if (t.type === 'pemasukan') inc += a
    else { exp += a; if (t.occurred_on === today) expToday += a; by.set(t.category_id ?? '-', (by.get(t.category_id ?? '-') ?? 0) + a) }
  }
  const balance = new Map((bal.data ?? []).map((b) => [b.account_id, Number(b.balance)]))
  const total = (accts.data ?? []).reduce((n, a) => n + (balance.get(a.id) ?? 0), 0)
  const month = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00Z`))
  return {
    head: ['💰 <b>Keuangan</b>', `<i>${month}</i>`],
    sections: [
      {
        title: 'Bulan ini', lines: [],
        table: [['Pemasukan', formatRupiah(inc)], ['Pengeluaran', formatRupiah(exp)], [inc - exp < 0 ? 'Defisit' : 'Sisa', formatRupiah(Math.abs(inc - exp))], ['Keluar hari ini', formatRupiah(expToday)]],
      },
      (accts.data ?? []).length
        ? { title: 'Saldo rekening', lines: [], table: [...(accts.data ?? []).map((a) => [plain(a.name, 16), formatRupiah(balance.get(a.id) ?? 0)] as [string, string]), ['Total', formatRupiah(total)]] }
        : { title: 'Saldo rekening', lines: ['<i>Belum ada rekening — tambahkan di web.</i>'] },
      ...(by.size ? [{ title: 'Pengeluaran terbesar', lines: [], table: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => [plain(cat.get(k) ?? 'Tanpa kategori', 16), `${formatRupiah(v)} (${exp ? Math.round((v / exp) * 100) : 0}%)`] as [string, string]) }] : []),
      ...((recent.data ?? []).length ? [{ title: 'Transaksi terakhir', quote: 'expand' as const, lines: (recent.data ?? []).map((t) => `<b>${t.type === 'pemasukan' ? '+' : '−'}${formatRupiah(t.amount)}</b>  ${cut(t.note || cat.get(t.category_id ?? '') || '', 26)} <i>· ${formatDay(t.occurred_on)}</i>`) }] : []),
    ],
    kb: [[btn('💸 Pengeluaran', 'f:keluar'), btn('💵 Pemasukan', 'f:masuk')], navRow('p:home', '/keuangan')],
  }
}

/* ================= Belajar ================= */
export async function learningPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const [subs, sess] = await Promise.all([
    ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(20),
    ctx.db.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', ctx.userId).gte('session_date', addDays(today, -6)).order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
  ])
  const per = new Map<string, number>()
  for (const s of sess.data ?? []) per.set(s.subject_id, (per.get(s.subject_id) ?? 0) + s.duration_minutes)
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  const name = new Map((subs.data ?? []).map((s) => [s.id, s.title]))
  return {
    head: ['📚 <b>Ruang Belajar</b>', '<i>7 hari terakhir</i>'],
    sections: [
      { title: 'Ringkasan', lines: [], table: [['Total waktu', formatDuration(total)], ['Jumlah sesi', String(sess.data?.length ?? 0)]] },
      (subs.data ?? []).length
        ? { title: 'Per bidang', lines: [], table: (subs.data ?? []).map((s) => [plain(s.title, 16), formatDuration(per.get(s.id) ?? 0)] as [string, string]) }
        : { title: 'Per bidang', lines: ['<i>Belum ada bidang aktif — tambahkan di web.</i>'] },
      ...((sess.data ?? []).length ? [{ title: 'Sesi terakhir', quote: 'expand' as const, lines: (sess.data ?? []).slice(0, 6).map((s) => `• ${formatDay(s.session_date)} — ${cut(name.get(s.subject_id) ?? 'Bidang', 22)} <b>${formatDuration(s.duration_minutes)}</b>${s.material ? ` <i>${cut(s.material, 24)}</i>` : ''}`) }] : []),
    ],
    kb: [[btn('➕ Catat sesi belajar', 'f:sesi')], navRow('p:home', '/belajar')],
  }
}

/* ================= Catatan & Jurnal ================= */
export async function journalPanel(ctx: Ctx): Promise<Panel> {
  const { data } = await ctx.db.from('journal_entries').select('id, kind, title, content, entry_date, mood').eq('user_id', ctx.userId).eq('is_archived', false)
    .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(8)
  const list = data ?? []
  return {
    head: ['🗒 <b>Catatan & Jurnal</b>', `<i>${list.length ? 'Terbaru · ketuk nomor untuk membaca' : 'Belum ada catatan'}</i>`],
    sections: [{
      lines: list.length ? list.map((j, i) => `<b>${i + 1}. ${cut(j.title || j.content.split('\n')[0] || 'Tanpa judul', 40)}</b>\n<i>${JOURNAL_KIND[j.kind]?.label ?? j.kind} · ${formatDay(j.entry_date)}${j.mood ? ` · ${MOOD[j.mood]}` : ''}</i>`) : ['Tulis catatan pertamamu lewat tombol di bawah, atau kirim pesan apa saja ke Rupi.'],
    }],
    kb: [...rows(list.map((j, i) => btn(String(i + 1), `jn:${j.id}`)), 4), [btn('➕ Catatan / Jurnal', 'f:catatan')], navRow('p:home', '/jurnal')],
  }
}

export async function journalDetailPanel(ctx: Ctx, id: string): Promise<Panel | null> {
  const { data: j } = await ctx.db.from('journal_entries').select('id, kind, title, content, entry_date, mood, tags').eq('id', id).eq('user_id', ctx.userId).maybeSingle()
  if (!j) return null
  return {
    head: [`🗒 <b>${esc(j.title || 'Tanpa judul')}</b>`, `<i>${JOURNAL_KIND[j.kind]?.label ?? j.kind} · ${formatDay(j.entry_date)}${j.mood ? ` · ${MOOD[j.mood]}` : ''}</i>`],
    sections: [
      { lines: [j.content ? cut(j.content, 1500) : '<i>(tanpa isi)</i>'], quote: j.content.length > 300 ? 'expand' : true },
      ...((j.tags ?? []).length ? [{ lines: [(j.tags as string[]).map((t) => `#${esc(t.replace(/\s+/g, '_'))}`).join(' ')] }] : []),
    ],
    kb: [navRow('p:jurnal', `/jurnal/${id}`, '⬅️ Jurnal')],
  }
}

/* ================= Kebiasaan ================= */
export async function habitsPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const [{ data: habits }, { data: checks }] = await Promise.all([
    ctx.db.from('habits').select('id, name, frequency, times_per_week').eq('user_id', ctx.userId).eq('is_archived', false).order('created_at').limit(12),
    ctx.db.from('habit_checkins').select('habit_id, checkin_date').eq('user_id', ctx.userId).gte('checkin_date', addDays(today, -400)).limit(20000),
  ])
  const by = new Map<string, string[]>()
  for (const c of checks ?? []) by.set(c.habit_id, [...(by.get(c.habit_id) ?? []), c.checkin_date])
  const list = (habits ?? []).map((h) => ({ ...h, s: habitStats(by.get(h.id) ?? [], today) }))
  const doneToday = list.filter((h) => h.s.doneToday).length
  return {
    head: ['🔁 <b>Kebiasaan</b>', `<i>${shortDay(today)} · ${doneToday}/${list.length} sudah check-in · ketuk untuk check-in</i>`],
    sections: list.length ? list.map((h) => ({
      title: `${h.s.doneToday ? '✅' : '⬜'} ${cut(h.name, 36)}`,
      lines: [
        `${h.s.last7.map((d) => (d.done ? '🟩' : '⬜')).join('')}`,
        `<i>${h.frequency === 'harian' ? `Streak ${h.s.current} hari · terbaik ${h.s.best}` : `Minggu ini ${h.s.thisWeek}/${h.times_per_week}×`}</i>`,
      ],
    })) : [{ lines: ['<i>Belum ada kebiasaan — tambahkan di web.</i>'] }],
    kb: [...list.map((h) => [btn(`${h.s.doneToday ? '✅' : '⬜'} ${h.name.length > 28 ? `${h.name.slice(0, 27)}…` : h.name}`, `hb:${h.id}`)]), navRow('p:home', '/kebiasaan')],
  }
}

/* ================= Pencapaian ================= */
export async function badgesPanel(ctx: Ctx): Promise<Panel> {
  await ctx.db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
  const [{ data: defs }, { data: earned }] = await Promise.all([
    ctx.db.from('achievements').select('id, name, description, sort_order').order('sort_order'),
    ctx.db.from('user_achievements').select('achievement_id, earned_at').eq('user_id', ctx.userId),
  ])
  const at = new Map((earned ?? []).map((e) => [e.achievement_id, e.earned_at as string]))
  const got = (defs ?? []).filter((d) => at.has(d.id)), locked = (defs ?? []).filter((d) => !at.has(d.id))
  return {
    head: ['🏆 <b>Pencapaian</b>', `<i>${got.length} dari ${(defs ?? []).length} lencana diraih</i>`],
    sections: [
      got.length
        ? { title: 'Sudah diraih', lines: [], table: got.map((d) => [plain(d.name, 18), formatDay(dayOf(at.get(d.id)!, ctx.tz))] as [string, string]) }
        : { title: 'Sudah diraih', lines: ['<i>Belum ada — ayo mulai!</i>'] },
      { title: 'Belum diraih', quote: 'expand', lines: locked.map((d) => `• <b>${esc(d.name)}</b> — <i>${esc(d.description)}</i>`) },
    ],
    kb: [navRow('p:home', '/pencapaian')],
  }
}

/* ================= Ringkasan mingguan ================= */
export async function weeklyPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const cur = addDays(today, -6), prev = addDays(today, -13)
  const curIso = startOfDayIso(cur, ctx.tz)
  const [done, sess, notes, checks, spend] = await Promise.all([
    ctx.db.from('tasks').select('completed_at').eq('user_id', ctx.userId).gte('completed_at', startOfDayIso(prev, ctx.tz)).limit(5000),
    ctx.db.from('learning_sessions').select('session_date, duration_minutes').eq('user_id', ctx.userId).gte('session_date', prev).limit(5000),
    ctx.db.from('journal_entries').select('entry_date').eq('user_id', ctx.userId).gte('entry_date', prev).limit(5000),
    ctx.db.from('habit_checkins').select('checkin_date').eq('user_id', ctx.userId).gte('checkin_date', prev).limit(10000),
    ctx.db.from('transactions').select('occurred_on, amount').eq('user_id', ctx.userId).eq('type', 'pengeluaran').gte('occurred_on', prev).limit(10000),
  ])
  const split = <T,>(rows_: T[] | null, isCur: (r: T) => boolean, w: (r: T) => number = () => 1) => {
    let c = 0, p = 0
    for (const r of rows_ ?? []) { if (isCur(r)) c += w(r); else p += w(r) }
    return [c, p] as const
  }
  const data: Array<[string, readonly [number, number], (n: number) => string, boolean]> = [
    ['Tugas selesai', split(done.data, (r) => r.completed_at! >= curIso), formatNumber, false],
    ['Belajar', split(sess.data, (r) => r.session_date >= cur, (r) => r.duration_minutes), formatDuration, false],
    ['Catatan', split(notes.data, (r) => r.entry_date >= cur), formatNumber, false],
    ['Check-in', split(checks.data, (r) => r.checkin_date >= cur), formatNumber, false],
    ['Pengeluaran', split(spend.data, (r) => r.occurred_on >= cur, (r) => Number(r.amount)), formatRupiah, true],
  ]
  // Tabel 3 kolom: label | 7 hari ini | 7 hari sebelumnya, dengan tanda naik/turun.
  const cells = data.map(([l, [c, p], f, lowerBetter]) => ({ l, c: f(c), p: f(p), t: c === p ? ' ' : (c > p) !== lowerBetter ? '↑' : '↓' }))
  const wl = Math.max(...cells.map((x) => x.l.length)), wc = Math.max(5, ...cells.map((x) => x.c.length)), wp = Math.max(7, ...cells.map((x) => x.p.length))
  return {
    head: ['📊 <b>Ringkasan Mingguan</b>', `<i>${shortDay(cur)} – ${shortDay(today)} dibanding 7 hari sebelumnya</i>`],
    sections: [{
      lines: [],
      pre: [
        `${''.padEnd(wl)}  ${'Ini'.padStart(wc)}  ${'Sebelum'.padStart(wp)}`,
        ...cells.map((x) => `${x.l.padEnd(wl)}  ${x.c.padStart(wc)}  ${x.p.padStart(wp)} ${x.t}`),
      ],
    }],
    foot: ['<i>↑ membaik · ↓ menurun</i>'],
    kb: [navRow('p:home', '/pencapaian')],
  }
}

/* ================= Pengingat 24 jam ================= */
export async function remindersPanel(ctx: Ctx): Promise<Panel> {
  const { data } = await ctx.db.from('tasks').select('id, kind, title, due_at, start_at, remind_before_minutes')
    .eq('user_id', ctx.userId).in('status', OPEN).not('remind_before_minutes', 'is', null).is('reminded_at', null).limit(200)
  const now = Date.now()
  const soon = (data ?? []).map((t) => ({ ...t, at: anchorOf(t) })).filter((t) => t.at)
    .map((t) => ({ ...t, fire: new Date(t.at!).getTime() - t.remind_before_minutes! * 60_000 }))
    .filter((t) => t.fire <= now + 86_400_000 && new Date(t.at!).getTime() > now).sort((a, b) => a.fire - b.fire).slice(0, 15)
  return {
    head: ['🔔 <b>Pengingat</b>', '<i>24 jam ke depan</i>'],
    sections: [{ quote: true, lines: soon.length ? soon.map((t) => `• <b>${formatTime(new Date(t.fire).toISOString(), ctx.tz)}</b>  ${cut(t.title, 40)}`) : ['Tidak ada pengingat dalam 24 jam ke depan.', '<i>Atur pengingat saat menambah tugas.</i>'] }],
    kb: [navRow()],
  }
}

/* ================= Pengaturan ================= */
export async function settingsPanel(ctx: Ctx): Promise<Panel> {
  const [{ data: prof }, { data: conn }] = await Promise.all([
    ctx.db.from('profiles').select('display_name, timezone, notification_settings').eq('id', ctx.userId).maybeSingle(),
    ctx.db.from('telegram_connections').select('username, linked_at').eq('user_id', ctx.userId).maybeSingle(),
  ])
  const ns = (prof?.notification_settings ?? {}) as { digest?: boolean; digest_time?: string }
  const on = ns.digest !== false
  const time = ns.digest_time ?? '07:00'
  const times = rows(['05:00', '06:00', '07:00', '08:00', '12:00', '20:00'].map((t) => btn(`${t === time ? '● ' : ''}${t.replace(':', '.')}`, `set:dt:${t.slice(0, 2)}`)), 3)
  return {
    head: ['⚙️ <b>Pengaturan</b>'],
    sections: [
      { title: 'Akun', lines: [], table: [['Nama', plain(prof?.display_name || '—')], ['Zona waktu', prof?.timezone ?? 'Asia/Jakarta'], ['Telegram', conn?.username ? `@${conn.username}` : 'tertaut'], ...(conn ? [['Tertaut sejak', formatDay(dayOf(conn.linked_at, ctx.tz))] as [string, string]] : [])] },
      { title: 'Ringkasan harian', lines: [], table: [['Status', on ? 'Aktif' : 'Nonaktif'], ['Jam kirim', time.replace(':', '.')]] },
      { lines: ['<i>Pengingat tiap tugas diatur saat menambah tugas.</i>'] },
    ],
    kb: [
      [btn(on ? '🔕 Matikan ringkasan harian' : '🔔 Aktifkan ringkasan harian', 'set:dg')],
      ...times,
      [btn('🔔 Pengingat 24 jam', 'p:ingat'), btn('📖 Bantuan', 'p:bantuan')],
      [btn('🔌 Putuskan bot', 'set:putus', 'danger')],
      [btn('⬅️ Menu', 'p:home'), link('🌐 Pengaturan web', '/pengaturan')],
    ],
  }
}

export function helpPanel(): Panel {
  return {
    head: ['📖 <b>Bantuan Rupi</b>', '<i>Semua fitur bisa dipakai lewat tombol. Perintah cepat:</i>'],
    sections: [
      { title: 'Perintah', lines: ['/menu — ringkasan & menu utama', '/tugas — tugas & kegiatan', '/tambah <i>judul [besok] [09.00]</i>', '/catat <i>isi catatan</i>', '/belajar <i>menit bidang materi</i>', '/keluar <i>jumlah keterangan</i> — pengeluaran', '/masuk <i>jumlah keterangan</i> — pemasukan', '/kalender · /target · /keuangan', '/kebiasaan · /ringkasan · /pengingat', '/batal — batalkan isian', '/putus — putuskan bot'] },
      { title: 'Pesan bebas', lines: ['Kirim teks apa saja → pilih <b>simpan sebagai catatan</b> atau <b>jadikan tugas</b>.'] },
    ],
    kb: [navRow('p:home')],
  }
}

/* ================= Pengingat (pesan dari cron) ================= */
export function reminderText(t: { id: string; kind: string; title: string; due_at: string | null; start_at: string | null; end_at: string | null; location: string }, tz: string) {
  const at = anchorOf(t)
  const mins = at ? Math.round((new Date(at).getTime() - Date.now()) / 60_000) : null
  const rel = mins === null ? '' : mins <= 0 ? 'sekarang' : mins < 60 ? `${mins} menit lagi` : `${formatDuration(mins)} lagi`
  const rows_: Array<[string, string]> = [
    [t.kind === 'kegiatan' ? 'Mulai' : t.due_at ? 'Tenggat' : 'Mulai', `${formatShort(at!, tz)}${t.kind === 'kegiatan' && t.end_at ? `–${formatTime(t.end_at, tz)}` : ''}`],
    ...(rel ? [['Waktu', rel] as [string, string]] : []),
    ...(t.location ? [['Lokasi', plain(t.location)] as [string, string]] : []),
  ]
  const w = Math.max(...rows_.map((r) => r[0].length))
  return [
    `${t.kind === 'kegiatan' ? '📅' : '⏰'} <b>Pengingat ${t.kind === 'kegiatan' ? 'kegiatan' : 'tugas'}</b>`,
    '',
    `<b>${esc(t.title)}</b>`,
    `<pre>${esc(rows_.map(([l, v]) => `${l.padEnd(w)} : ${v}`).join('\n'))}</pre>`,
  ].join('\n')
}

export function reminderKeyboard(t: { id: string; kind: string }): Keyboard {
  return [
    [...(t.kind === 'tugas' ? [btn('✅ Tandai selesai', `d:${t.id}`, 'success')] : []), btn('📄 Detail', `td:${t.id}`)],
    [btn('🏠 Menu', 'p:home'), link('🌐 Buka', `/tugas/${t.id}`)],
  ]
}
