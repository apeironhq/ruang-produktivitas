import 'server-only'
import { goalNumbers } from '../../app/(app)/target/GoalCard'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatRupiah, formatShort, formatTime } from '../format'
import { habitStats } from '../habits'
import { projectProgress } from '../projects'
import { loadGoals, todayAgenda } from './panels'
import { OPEN, longDay, type Ctx } from './ui'

/*
 * Data pengguna untuk Rupi AI (hanya bila pengguna mengizinkan di Pengaturan).
 *  - Ringkasan dasar selalu dikirim (agenda, terlambat, 3 hari ke depan, target, keuangan, kebiasaan, pengingat).
 *  - Rincian per topik ditambahkan bila pesan / percakapan terakhir menyinggung topiknya
 *    (keuangan, tugas, proyek, target, belajar, kebiasaan, jurnal) — atau semuanya untuk evaluasi umum.
 * Teks biasa yang ringkas — dikirim ke penyedia AI pilihan pengguna bersama pesannya.
 */

export type Topic = 'keuangan' | 'tugas' | 'proyek' | 'target' | 'belajar' | 'kebiasaan' | 'jurnal'

const TOPIC_RE: Record<Topic, RegExp> = {
  keuangan: /uang|duit|boros|hemat|keluar|pengeluaran|pemasukan|gaji|saldo|rekening|anggaran|budget|belanja|jajan|bayar|tabung|nabung|keuangan|cicil|utang|hutang|biaya|harga|\brp\b|ribu|juta|rb\b|jt\b|transaksi|kategori/i,
  tugas: /tugas|kerjaan|pekerjaan|deadline|tenggat|telat|terlambat|todo|to-do|kegiatan|jadwal|agenda|rapat|meeting|minggu (ini|depan)|besok|lusa|kalender|sibuk|prioritas/i,
  proyek: /proyek|project|projek/i,
  target: /target|goal|tujuan|progres|progress|capai|tercapai|milestone|tahapan/i,
  belajar: /belajar|kursus|materi|bidang|study|skripsi|kuliah|ujian|buku|sesi belajar|modul/i,
  kebiasaan: /kebiasaan|habit|streak|rutin|olahraga|check-?in|konsisten/i,
  jurnal: /jurnal|catatan|curhat|mood|perasaan|refleksi|cerita|hari ini aku|lagi sedih|lagi senang|capek|stres|stress/i,
}
const ALL_RE = /semua|seluruh|evaluasi|review|perkembangan|gimana (aku|saya|hidupku)|kondisi(ku| saya)|ringkas(an|in)|rangkum|analisis|analisa|saran(in)?|rekomendasi/i

/** Topik yang disinggung teks (pesan + beberapa pesan pengguna sebelumnya). */
export function topicsOf(text: string): Topic[] {
  const specific = (Object.keys(TOPIC_RE) as Topic[]).filter((t) => TOPIC_RE[t].test(text))
  // Topik yang disebut jelas menang; kata umum ("saran", "evaluasi") tanpa topik → semua rincian.
  if (specific.length) return specific
  return ALL_RE.test(text) ? (Object.keys(TOPIC_RE) as Topic[]) : []
}

const MAX_BASE = 3500
const MAX_SECTION = 1800
const clip = (s: string | null | undefined, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const monthName = (ym: string) => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`))

export async function dataSnapshot(ctx: Ctx, topicText = ''): Promise<string> {
  const topics = topicsOf(topicText)
  const [base, ...details] = await Promise.all([
    baseSnapshot(ctx),
    ...topics.map((t) => DETAIL[t](ctx).then((s) => (s ? cap(s, MAX_SECTION) : '')).catch(() => '')),
  ])
  return [base, ...details.filter(Boolean)].join('\n\n')
}

async function baseSnapshot(ctx: Ctx): Promise<string> {
  const today = todayIn(ctx.tz)
  const tomorrow = startOfDayIso(addDays(today, 1), ctx.tz)
  const in4 = startOfDayIso(addDays(today, 4), ctx.tz)
  const monthStart = `${today.slice(0, 7)}-01`
  const nowIso = new Date().toISOString()
  const [agenda, soonTasks, soonEvents, openCount, goals, tx, accts, bal, habits, checks, timers] = await Promise.all([
    todayAgenda(ctx),
    ctx.db.from('tasks').select('title, due_at').eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN)
      .gte('due_at', tomorrow).lt('due_at', in4).order('due_at').limit(8),
    ctx.db.from('tasks').select('title, start_at, location').eq('user_id', ctx.userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan')
      .gte('start_at', tomorrow).lt('start_at', in4).order('start_at').limit(8),
    ctx.db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN),
    loadGoals(ctx).catch(() => []),
    ctx.db.from('transactions').select('type, amount, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', monthStart).limit(5000),
    ctx.db.from('financial_accounts').select('id').eq('user_id', ctx.userId).eq('is_archived', false),
    ctx.db.from('account_balances').select('account_id, balance').eq('user_id', ctx.userId),
    ctx.db.from('habits').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).eq('frequency', 'harian').limit(20),
    ctx.db.from('habit_checkins').select('habit_id').eq('user_id', ctx.userId).eq('checkin_date', today).limit(200),
    ctx.db.from('bot_timers').select('kind, label, fire_at').eq('user_id', ctx.userId).is('sent_at', null).gte('fire_at', nowIso).order('fire_at').limit(6),
  ])

  const out: string[] = []
  const time = (iso: string) => formatTime(iso, ctx.tz)
  const when = (iso: string) => formatShort(iso, ctx.tz)

  const todayItems = [
    ...agenda.events.map((e) => ({ at: e.start_at!, line: `${time(e.start_at!)} Kegiatan: ${clip(e.title)}${e.location ? ` (di ${clip(e.location, 30)})` : ''}` })),
    ...agenda.dueToday.map((t) => {
      const at = (t.due_at ?? t.start_at)!
      return { at, line: `${time(at)} Tugas: ${clip(t.title)}${new Date(at).getTime() < Date.now() ? ' (tenggat sudah lewat)' : ''}` }
    }),
  ].sort((a, b) => a.at.localeCompare(b.at))
  out.push(`Agenda hari ini (${longDay(today)}):`, ...(todayItems.length ? todayItems.map((i) => `- ${i.line}`) : ['- kosong']))

  if (agenda.overdue.length) {
    out.push(`Tugas terlambat (${agenda.overdue.length}${agenda.overdue.length >= 10 ? '+' : ''}):`, ...agenda.overdue.slice(0, 8).map((t) => `- ${clip(t.title)} (tenggat ${when(t.due_at!)})`))
  }

  const soon = [
    ...(soonEvents.data ?? []).map((e) => ({ at: e.start_at as string, line: `${when(e.start_at as string)} Kegiatan: ${clip(e.title)}${e.location ? ` (di ${clip(e.location, 30)})` : ''}` })),
    ...(soonTasks.data ?? []).map((t) => ({ at: t.due_at as string, line: `${when(t.due_at as string)} Tugas: ${clip(t.title)}` })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  out.push('3 hari ke depan:', ...(soon.length ? soon.slice(0, 10).map((i) => `- ${i.line}`) : ['- kosong']))
  out.push(`Total tugas belum selesai: ${openCount.count ?? 0}`)

  if (goals.length) {
    out.push('Target aktif:', ...goals.slice(0, 8).map((g) => `- ${clip(g.title)}: ${g.percent}% (${goalNumbers(g).summary}, sisa ${goalNumbers(g).remaining}${g.due_date ? `, tenggat ${g.due_date}` : ''})`))
  } else out.push('Target aktif: tidak ada')

  let inc = 0, exp = 0, expToday = 0
  for (const t of tx.data ?? []) {
    const a = Number(t.amount)
    if (t.type === 'pemasukan') inc += a
    else { exp += a; if (t.occurred_on === today) expToday += a }
  }
  const active = new Set((accts.data ?? []).map((a) => a.id))
  const saldo = (bal.data ?? []).filter((b) => active.has(b.account_id)).reduce((n, b) => n + Number(b.balance), 0)
  out.push(`Keuangan bulan ini: pemasukan ${formatRupiah(inc)}, pengeluaran ${formatRupiah(exp)}, keluar hari ini ${formatRupiah(expToday)}, saldo semua rekening ${formatRupiah(saldo)}.`)

  const hs = habits.data ?? []
  if (hs.length) {
    const done = new Set((checks.data ?? []).map((c) => c.habit_id))
    const todo = hs.filter((h) => !done.has(h.id)).map((h) => clip(h.name, 30))
    out.push(`Kebiasaan harian: ${hs.length - todo.length}/${hs.length} sudah check-in hari ini${todo.length ? ` (belum: ${todo.slice(0, 6).join(', ')})` : ''}.`)
  }

  const ts = timers.data ?? []
  if (ts.length) out.push('Pengingat/timer terjadwal:', ...ts.map((t) => `- ${when(t.fire_at)} ${t.kind === 'ingat' ? 'pengingat' : t.kind}${t.label ? `: ${clip(t.label, 50)}` : ''}`))

  return cap(out.join('\n'), MAX_BASE)
}

/* ================= Rincian per topik ================= */

const DETAIL: Record<Topic, (ctx: Ctx) => Promise<string>> = {
  async keuangan(ctx) {
    const today = todayIn(ctx.tz)
    const ym = today.slice(0, 7)
    const monthStart = `${ym}-01`
    const prev = new Date(`${monthStart}T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1)
    const prevYm = prev.toISOString().slice(0, 7)
    const [tx, cats, budgets, accts, bal, recent] = await Promise.all([
      ctx.db.from('transactions').select('type, amount, category_id, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', `${prevYm}-01`).limit(10000),
      ctx.db.from('transaction_categories').select('id, name').eq('user_id', ctx.userId),
      ctx.db.from('budgets').select('category_id, limit_amount').eq('user_id', ctx.userId).eq('month', monthStart),
      ctx.db.from('financial_accounts').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).order('name'),
      ctx.db.from('account_balances').select('account_id, balance').eq('user_id', ctx.userId),
      ctx.db.from('transactions').select('type, amount, category_id, occurred_on, note').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran'])
        .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(10),
    ])
    const cat = new Map((cats.data ?? []).map((c) => [c.id, c.name as string]))
    const name = (id: string | null) => (id && cat.get(id)) || 'Tanpa kategori'
    const sum = { cur: { inc: 0, exp: 0, by: new Map<string, number>() }, prev: { inc: 0, exp: 0, by: new Map<string, number>() } }
    for (const t of tx.data ?? []) {
      const b = String(t.occurred_on).startsWith(ym) ? sum.cur : sum.prev
      const a = Number(t.amount)
      if (t.type === 'pemasukan') b.inc += a
      else { b.exp += a; const k = name(t.category_id); b.by.set(k, (b.by.get(k) ?? 0) + a) }
    }
    const budget = new Map((budgets.data ?? []).map((x) => [name(x.category_id), Number(x.limit_amount)]))
    const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
    const day = Number(today.slice(8, 10))
    const out = [
      'RINCIAN KEUANGAN',
      `Pengeluaran per kategori ${monthName(ym)}:`,
      ...(sum.cur.by.size ? top(sum.cur.by, 10).map(([k, v]) => {
        const lim = budget.get(k)
        return `- ${clip(k, 30)}: ${formatRupiah(v)}${lim ? ` (anggaran ${formatRupiah(lim)}, ${v > lim ? `lebih ${formatRupiah(v - lim)}` : `sisa ${formatRupiah(lim - v)}`})` : ''}`
      }) : ['- belum ada']),
      `Rata-rata pengeluaran per hari bulan ini: ${formatRupiah(Math.round(sum.cur.exp / Math.max(1, day)))}.`,
      ...(budget.size ? [`Total anggaran bulan ini: ${formatRupiah([...budget.values()].reduce((a, b) => a + b, 0))}.`] : ['Anggaran bulan ini: belum diatur.']),
      `${monthName(prevYm)}: pemasukan ${formatRupiah(sum.prev.inc)}, pengeluaran ${formatRupiah(sum.prev.exp)}${sum.prev.by.size ? `; teratas: ${top(sum.prev.by, 5).map(([k, v]) => `${clip(k, 20)} ${formatRupiah(v)}`).join(', ')}` : ''}.`,
    ]
    const balance = new Map((bal.data ?? []).map((b) => [b.account_id, Number(b.balance)]))
    if (accts.data?.length) out.push(`Saldo per rekening: ${accts.data.map((a) => `${clip(a.name, 20)} ${formatRupiah(balance.get(a.id) ?? 0)}`).join(', ')}.`)
    if (recent.data?.length) out.push('Transaksi terakhir:', ...recent.data.map((t) => `- ${t.occurred_on} ${t.type} ${formatRupiah(Number(t.amount))} · ${clip(name(t.category_id), 20)}${t.note ? ` · ${clip(t.note, 40)}` : ''}`))
    return out.join('\n')
  },

  async tugas(ctx) {
    const today = todayIn(ctx.tz)
    const from = startOfDayIso(today, ctx.tz)
    const in14 = startOfDayIso(addDays(today, 14), ctx.tz)
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [open, events, done, projects] = await Promise.all([
      ctx.db.from('tasks').select('title, due_at, priority, status, project_id').eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN)
        .order('due_at', { ascending: true, nullsFirst: false }).limit(30),
      ctx.db.from('tasks').select('title, start_at, location').eq('user_id', ctx.userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan')
        .gte('start_at', from).lt('start_at', in14).order('start_at').limit(15),
      ctx.db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'selesai').gte('completed_at', weekAgo),
      ctx.db.from('projects').select('id, title').eq('user_id', ctx.userId),
    ])
    const proj = new Map((projects.data ?? []).map((p) => [p.id, p.title as string]))
    return [
      'RINCIAN TUGAS & JADWAL',
      'Semua tugas belum selesai (urut tenggat):',
      ...((open.data ?? []).length ? (open.data ?? []).map((t) => `- ${clip(t.title)} · ${t.due_at ? `tenggat ${formatShort(t.due_at, ctx.tz)}` : 'tanpa tenggat'} · prioritas ${t.priority} · ${t.status}${t.project_id && proj.get(t.project_id) ? ` · proyek ${clip(proj.get(t.project_id), 25)}` : ''}`) : ['- tidak ada']),
      'Kegiatan 14 hari ke depan:',
      ...((events.data ?? []).length ? (events.data ?? []).map((e) => `- ${formatShort(e.start_at as string, ctx.tz)} ${clip(e.title)}${e.location ? ` (di ${clip(e.location, 25)})` : ''}`) : ['- tidak ada']),
      `Tugas diselesaikan 7 hari terakhir: ${done.count ?? 0}.`,
    ].join('\n')
  },

  async proyek(ctx) {
    const { data: projects } = await ctx.db.from('projects').select('id, title, status, due_date').eq('user_id', ctx.userId).in('status', ['rencana', 'aktif', 'ditunda']).order('due_date', { ascending: true, nullsFirst: false }).limit(10)
    if (!projects?.length) return 'RINCIAN PROYEK\nTidak ada proyek berjalan.'
    const nowIso = new Date().toISOString()
    const { data: tasks } = await ctx.db.from('tasks').select('project_id, status, due_at').eq('user_id', ctx.userId).in('project_id', projects.map((p) => p.id)).neq('status', 'dibatalkan').limit(2000)
    return ['RINCIAN PROYEK', ...projects.map((p) => {
      const ts = (tasks ?? []).filter((t) => t.project_id === p.id)
      const doneN = ts.filter((t) => t.status === 'selesai').length
      const late = ts.filter((t) => t.status !== 'selesai' && t.due_at && t.due_at < nowIso).length
      const pr = projectProgress({ done: doneN, total: ts.length }, { done: 0, total: 0 })
      return `- ${clip(p.title)} [${p.status}]: ${Math.round(pr.pct)}% (${pr.label})${late ? `, ${late} tugas terlambat` : ''}${p.due_date ? `, tenggat ${p.due_date}` : ''}`
    })].join('\n')
  },

  async target(ctx) {
    const goals = await loadGoals(ctx)
    if (!goals.length) return ''
    const { data: ms } = await ctx.db.from('goal_milestones').select('goal_id, title, threshold').in('goal_id', goals.map((g) => g.id)).order('threshold').limit(100)
    return ['RINCIAN TARGET', ...goals.map((g) => {
      const n = goalNumbers(g)
      const next = (ms ?? []).find((m) => m.goal_id === g.id && Number(m.threshold) > g.current)
      return `- ${clip(g.title)}: ${g.percent}% · sekarang ${n.current} dari ${n.target} · sisa ${n.remaining}${g.due_date ? ` · tenggat ${g.due_date}` : ''}${next ? ` · tahapan berikutnya "${clip(next.title, 30)}"` : ''}`
    })].join('\n')
  },

  async belajar(ctx) {
    const today = todayIn(ctx.tz)
    const since = addDays(today, -30)
    const [subjects, sessions] = await Promise.all([
      ctx.db.from('learning_subjects').select('id, title, status').eq('user_id', ctx.userId).eq('status', 'aktif').limit(15),
      ctx.db.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', ctx.userId).gte('session_date', since).order('session_date', { ascending: false }).limit(500),
    ])
    if (!subjects.data?.length) return 'RINCIAN BELAJAR\nTidak ada bidang belajar aktif.'
    return ['RINCIAN BELAJAR (30 hari terakhir)', ...subjects.data.map((s) => {
      const ss = (sessions.data ?? []).filter((x) => x.subject_id === s.id)
      const min = ss.reduce((n, x) => n + Number(x.duration_minutes ?? 0), 0)
      const last = ss[0]
      return `- ${clip(s.title)}: ${ss.length} sesi, ${Math.round(min / 6) / 10} jam${last ? ` · terakhir ${last.session_date}${last.material ? ` (${clip(last.material, 30)})` : ''}` : ' · belum ada sesi'}`
    })].join('\n')
  },

  async kebiasaan(ctx) {
    const today = todayIn(ctx.tz)
    const [habits, checks] = await Promise.all([
      ctx.db.from('habits').select('id, name, frequency, times_per_week').eq('user_id', ctx.userId).eq('is_archived', false).limit(20),
      ctx.db.from('habit_checkins').select('habit_id, checkin_date').eq('user_id', ctx.userId).gte('checkin_date', addDays(today, -60)).limit(5000),
    ])
    if (!habits.data?.length) return 'RINCIAN KEBIASAAN\nBelum ada kebiasaan.'
    return ['RINCIAN KEBIASAAN', ...habits.data.map((h) => {
      const st = habitStats((checks.data ?? []).filter((c) => c.habit_id === h.id).map((c) => c.checkin_date as string), today)
      return `- ${clip(h.name, 40)} (${h.frequency === 'harian' ? 'harian' : `${h.times_per_week}×/minggu`}): streak ${st.current} hari (terbaik ${st.best}), minggu ini ${st.thisWeek}×, hari ini ${st.doneToday ? 'sudah' : 'belum'}`
    })].join('\n')
  },

  async jurnal(ctx) {
    const { data } = await ctx.db.from('journal_entries').select('entry_date, kind, title, content, mood').eq('user_id', ctx.userId).eq('is_archived', false)
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(6)
    if (!data?.length) return 'RINCIAN JURNAL\nBelum ada catatan.'
    return ['RINCIAN JURNAL (catatan terbaru)', ...data.map((j) => `- ${j.entry_date} [${j.kind}]${j.mood ? ` mood ${j.mood}/5` : ''}: ${clip(j.title || '(tanpa judul)', 50)}${j.content ? ` — ${clip(j.content, 160)}` : ''}`)].join('\n')
  },
}
