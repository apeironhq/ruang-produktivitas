import 'server-only'
import { goalNumbers } from '../../app/(app)/target/GoalCard'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatRupiah, formatShort } from '../format'
import { habitStats } from '../habits'
import { projectProgress } from '../projects'
import { loadGoals } from './panels'
import { OPEN, longDay, type Ctx } from './ui'

/*
 * Data pengguna untuk Rupi AI (hanya bila pengguna mengizinkan di Pengaturan): seluruh bagian dashboard,
 * diringkas menjadi teks. Setiap item diberi kode pendek (T1 tugas/kegiatan, X1 transaksi, G1 target,
 * B1 bidang belajar, H1 kebiasaan, P1 proyek, J1 jurnal, R1 pengingat) agar Rupi bisa mengusulkan
 * perubahan atas item tertentu; kode diterjemahkan kembali ke id di server (lihat aiOps.ts).
 */

export type RefKind = 'tugas' | 'transaksi' | 'target' | 'belajar' | 'kebiasaan' | 'proyek' | 'jurnal' | 'pengingat'
export interface Ref { kind: RefKind; id: string; label: string; extra: Record<string, unknown> }
export interface Named { id: string; name: string }
export interface Snapshot {
  text: string
  refs: Record<string, Ref>
  accounts: Named[]
  categories: Array<Named & { type: string }>
}

const MAX_CHARS = 12000
const clip = (s: string | null | undefined, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const monthName = (ym: string) => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`))

export async function dataSnapshot(ctx: Ctx): Promise<Snapshot> {
  const today = todayIn(ctx.tz)
  const ym = today.slice(0, 7)
  const monthStart = `${ym}-01`
  const prev = new Date(`${monthStart}T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1)
  const prevYm = prev.toISOString().slice(0, 7)
  const from = startOfDayIso(today, ctx.tz)
  const in30 = startOfDayIso(addDays(today, 30), ctx.tz)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const nowIso = new Date().toISOString()
  const uid = ctx.userId
  const db = ctx.db

  const [openTasks, events, doneTasks, projects, projTasks, goals, milestones, tx, recentTx, cats, budgets, accts, bal,
    subjects, sessions, habits, checks, journal, timers] = await Promise.all([
    db.from('tasks').select('id, title, due_at, priority, status, project_id').eq('user_id', uid).eq('kind', 'tugas').in('status', OPEN)
      .order('due_at', { ascending: true, nullsFirst: false }).limit(40),
    db.from('tasks').select('id, title, start_at, end_at, location, status').eq('user_id', uid).eq('kind', 'kegiatan').in('status', OPEN)
      .gte('start_at', from).lt('start_at', in30).order('start_at').limit(20),
    db.from('tasks').select('id, title, kind, completed_at').eq('user_id', uid).eq('status', 'selesai').gte('completed_at', weekAgo).order('completed_at', { ascending: false }).limit(10),
    db.from('projects').select('id, title, status, due_date').eq('user_id', uid).in('status', ['rencana', 'aktif', 'ditunda']).order('due_date', { ascending: true, nullsFirst: false }).limit(12),
    db.from('tasks').select('project_id, status, due_at').eq('user_id', uid).not('project_id', 'is', null).neq('status', 'dibatalkan').limit(3000),
    loadGoals(ctx).catch(() => []),
    db.from('goal_milestones').select('goal_id, title, threshold').eq('user_id', uid).order('threshold').limit(200),
    db.from('transactions').select('type, amount, category_id, occurred_on').eq('user_id', uid).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', `${prevYm}-01`).limit(10000),
    db.from('transactions').select('id, type, amount, category_id, account_id, occurred_on, note').eq('user_id', uid).in('type', ['pemasukan', 'pengeluaran'])
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(25),
    db.from('transaction_categories').select('id, name, type').eq('user_id', uid).order('name'),
    db.from('budgets').select('category_id, limit_amount').eq('user_id', uid).eq('month', monthStart),
    db.from('financial_accounts').select('id, name').eq('user_id', uid).eq('is_archived', false).order('name'),
    db.from('account_balances').select('account_id, balance').eq('user_id', uid),
    db.from('learning_subjects').select('id, title').eq('user_id', uid).eq('status', 'aktif').limit(15),
    db.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', uid).gte('session_date', addDays(today, -30)).order('session_date', { ascending: false }).limit(500),
    db.from('habits').select('id, name, frequency, times_per_week').eq('user_id', uid).eq('is_archived', false).limit(20),
    db.from('habit_checkins').select('habit_id, checkin_date').eq('user_id', uid).gte('checkin_date', addDays(today, -60)).limit(5000),
    db.from('journal_entries').select('id, entry_date, kind, title, content, mood').eq('user_id', uid).eq('is_archived', false)
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(8),
    db.from('bot_timers').select('id, kind, label, fire_at').eq('user_id', uid).is('sent_at', null).gte('fire_at', nowIso).order('fire_at').limit(10),
  ])

  const refs: Record<string, Ref> = {}
  const counters: Record<string, number> = {}
  const ref = (prefix: string, r: Ref) => { counters[prefix] = (counters[prefix] ?? 0) + 1; const code = `${prefix}${counters[prefix]}`; refs[code] = r; return code }
  const when = (iso: string) => formatShort(iso, ctx.tz)
  const out: string[] = []

  // ---- Rekening & kategori (dipakai juga untuk aksi uang) ----
  const accounts = (accts.data ?? []) as Named[]
  const categories = (cats.data ?? []) as Array<Named & { type: string }>
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const accName = new Map(accounts.map((a) => [a.id, a.name]))
  const balance = new Map((bal.data ?? []).map((b) => [b.account_id, Number(b.balance)]))
  const saldo = accounts.reduce((n, a) => n + (balance.get(a.id) ?? 0), 0)

  // ---- Tugas & kegiatan ----
  const proj = new Map((projects.data ?? []).map((p) => [p.id, p.title as string]))
  out.push('== TUGAS (belum selesai, urut tenggat) ==')
  const tasks = openTasks.data ?? []
  if (!tasks.length) out.push('- tidak ada')
  for (const t of tasks) {
    const late = t.due_at && t.due_at < nowIso
    const code = ref('T', { kind: 'tugas', id: t.id, label: t.title, extra: { kind: 'tugas', due_at: t.due_at } })
    out.push(`${code} · ${clip(t.title)} · ${t.due_at ? `tenggat ${when(t.due_at)}${late ? ' (TERLAMBAT)' : ''}` : 'tanpa tenggat'} · prioritas ${t.priority} · ${t.status}${t.project_id && proj.get(t.project_id) ? ` · proyek ${clip(proj.get(t.project_id), 25)}` : ''}`)
  }
  out.push('== KEGIATAN (30 hari ke depan) ==')
  const evs = events.data ?? []
  if (!evs.length) out.push('- tidak ada')
  for (const e of evs) {
    const code = ref('T', { kind: 'tugas', id: e.id, label: e.title, extra: { kind: 'kegiatan', start_at: e.start_at, end_at: e.end_at } })
    out.push(`${code} · ${when(e.start_at as string)}${e.end_at ? `–${formatShort(e.end_at, ctx.tz).split(', ').pop()}` : ''} · ${clip(e.title)}${e.location ? ` · di ${clip(e.location, 30)}` : ''}`)
  }
  const dones = doneTasks.data ?? []
  if (dones.length) {
    out.push('== SELESAI 7 HARI TERAKHIR ==')
    for (const t of dones) {
      const code = ref('T', { kind: 'tugas', id: t.id, label: t.title, extra: { kind: t.kind, done: true } })
      out.push(`${code} · ${clip(t.title)} · selesai ${when(t.completed_at as string)}`)
    }
  }

  // ---- Keuangan ----
  const sum = { cur: { inc: 0, exp: 0, by: new Map<string, number>() }, prev: { inc: 0, exp: 0, by: new Map<string, number>() } }
  for (const t of tx.data ?? []) {
    const b = String(t.occurred_on).startsWith(ym) ? sum.cur : sum.prev
    const a = Number(t.amount)
    if (t.type === 'pemasukan') b.inc += a
    else { b.exp += a; const k = (t.category_id && catName.get(t.category_id)) || 'Tanpa kategori'; b.by.set(k, (b.by.get(k) ?? 0) + a) }
  }
  const budget = new Map((budgets.data ?? []).map((x) => [catName.get(x.category_id) ?? '?', Number(x.limit_amount)]))
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
  const day = Number(today.slice(8, 10))
  out.push(`== KEUANGAN ${monthName(ym).toUpperCase()} ==`,
    `Pemasukan ${formatRupiah(sum.cur.inc)}, pengeluaran ${formatRupiah(sum.cur.exp)}, selisih ${formatRupiah(sum.cur.inc - sum.cur.exp)}, rata-rata keluar per hari ${formatRupiah(Math.round(sum.cur.exp / Math.max(1, day)))}.`,
    'Pengeluaran per kategori:',
    ...(sum.cur.by.size ? top(sum.cur.by, 12).map(([k, v]) => {
      const lim = budget.get(k)
      return `- ${clip(k, 30)}: ${formatRupiah(v)}${lim ? ` (anggaran ${formatRupiah(lim)}, ${v > lim ? `LEBIH ${formatRupiah(v - lim)}` : `sisa ${formatRupiah(lim - v)}`})` : ''}`
    }) : ['- belum ada']),
    budget.size ? `Anggaran lain tanpa pengeluaran: ${[...budget].filter(([k]) => !sum.cur.by.has(k)).map(([k, v]) => `${clip(k, 20)} ${formatRupiah(v)}`).join(', ') || '-'}` : 'Anggaran bulan ini: belum diatur.',
    `${monthName(prevYm)}: pemasukan ${formatRupiah(sum.prev.inc)}, pengeluaran ${formatRupiah(sum.prev.exp)}${sum.prev.by.size ? `; teratas: ${top(sum.prev.by, 5).map(([k, v]) => `${clip(k, 20)} ${formatRupiah(v)}`).join(', ')}` : ''}.`,
    `Rekening (saldo): ${accounts.length ? accounts.map((a) => `${a.name} ${formatRupiah(balance.get(a.id) ?? 0)}`).join(', ') : 'belum ada'} · total ${formatRupiah(saldo)}.`,
    `Kategori pengeluaran: ${categories.filter((c) => c.type === 'pengeluaran').map((c) => c.name).join(', ') || '-'}.`,
    `Kategori pemasukan: ${categories.filter((c) => c.type === 'pemasukan').map((c) => c.name).join(', ') || '-'}.`,
    'Transaksi terbaru:')
  const txs = recentTx.data ?? []
  if (!txs.length) out.push('- belum ada')
  for (const t of txs) {
    const code = ref('X', { kind: 'transaksi', id: t.id, label: `${t.type} ${formatRupiah(Number(t.amount))} · ${(t.category_id && catName.get(t.category_id)) || 'tanpa kategori'} · ${t.occurred_on}${t.note ? ` · ${t.note}` : ''}`, extra: { type: t.type, amount: Number(t.amount), category_id: t.category_id, account_id: t.account_id, occurred_on: t.occurred_on, note: t.note } })
    out.push(`${code} · ${t.occurred_on} · ${t.type} ${formatRupiah(Number(t.amount))} · ${clip((t.category_id && catName.get(t.category_id)) || 'tanpa kategori', 20)} · ${clip(accName.get(t.account_id) ?? '?', 20)}${t.note ? ` · ${clip(t.note, 40)}` : ''}`)
  }

  // ---- Target ----
  out.push('== TARGET AKTIF ==')
  if (!goals.length) out.push('- tidak ada')
  for (const g of goals) {
    const n = goalNumbers(g)
    const next = (milestones.data ?? []).find((m) => m.goal_id === g.id && Number(m.threshold) > g.current)
    const code = ref('G', { kind: 'target', id: g.id, label: g.title, extra: { manual: g.progress_source === 'manual', metric: g.metric_type, unit: g.unit_label } })
    out.push(`${code} · ${clip(g.title)} · ${g.percent}% · ${n.current} dari ${n.target} · sisa ${n.remaining}${g.due_date ? ` · tenggat ${g.due_date}` : ''}${next ? ` · tahapan berikutnya "${clip(next.title, 30)}"` : ''}${g.progress_source === 'manual' ? '' : ` · progres otomatis dari ${g.progress_source}`}`)
  }

  // ---- Proyek ----
  out.push('== PROYEK BERJALAN ==')
  const ps = projects.data ?? []
  if (!ps.length) out.push('- tidak ada')
  for (const p of ps) {
    const ts = (projTasks.data ?? []).filter((t) => t.project_id === p.id)
    const doneN = ts.filter((t) => t.status === 'selesai').length
    const late = ts.filter((t) => t.status !== 'selesai' && t.due_at && t.due_at < nowIso).length
    const pr = projectProgress({ done: doneN, total: ts.length }, { done: 0, total: 0 })
    const code = ref('P', { kind: 'proyek', id: p.id, label: p.title, extra: {} })
    out.push(`${code} · ${clip(p.title)} · ${p.status} · ${Math.round(pr.pct)}% (${pr.label})${late ? ` · ${late} tugas terlambat` : ''}${p.due_date ? ` · tenggat ${p.due_date}` : ''}`)
  }

  // ---- Belajar ----
  out.push('== BELAJAR (30 hari terakhir) ==')
  const ss = subjects.data ?? []
  if (!ss.length) out.push('- tidak ada bidang aktif')
  for (const s of ss) {
    const xs = (sessions.data ?? []).filter((x) => x.subject_id === s.id)
    const min = xs.reduce((n, x) => n + Number(x.duration_minutes ?? 0), 0)
    const code = ref('B', { kind: 'belajar', id: s.id, label: s.title, extra: {} })
    out.push(`${code} · ${clip(s.title)} · ${xs.length} sesi, ${Math.round(min / 6) / 10} jam${xs[0] ? ` · terakhir ${xs[0].session_date}${xs[0].material ? ` (${clip(xs[0].material, 30)})` : ''}` : ''}`)
  }

  // ---- Kebiasaan ----
  out.push('== KEBIASAAN ==')
  const hs = habits.data ?? []
  if (!hs.length) out.push('- tidak ada')
  for (const h of hs) {
    const st = habitStats((checks.data ?? []).filter((c) => c.habit_id === h.id).map((c) => c.checkin_date as string), today)
    const code = ref('H', { kind: 'kebiasaan', id: h.id, label: h.name, extra: { doneToday: st.doneToday } })
    out.push(`${code} · ${clip(h.name, 40)} · ${h.frequency === 'harian' ? 'harian' : `${h.times_per_week}×/minggu`} · streak ${st.current} (terbaik ${st.best}) · minggu ini ${st.thisWeek}× · hari ini ${st.doneToday ? 'sudah' : 'belum'} check-in`)
  }

  // ---- Jurnal ----
  out.push('== JURNAL TERBARU ==')
  const js = journal.data ?? []
  if (!js.length) out.push('- tidak ada')
  for (const j of js) {
    const code = ref('J', { kind: 'jurnal', id: j.id, label: j.title || clip(j.content, 40), extra: {} })
    out.push(`${code} · ${j.entry_date} · ${j.kind}${j.mood ? ` · mood ${j.mood}/5` : ''} · ${clip(j.title || '(tanpa judul)', 50)}${j.content ? ` — ${clip(j.content, 140)}` : ''}`)
  }

  // ---- Pengingat ----
  out.push('== PENGINGAT / TIMER TERJADWAL ==')
  const tms = timers.data ?? []
  if (!tms.length) out.push('- tidak ada')
  for (const t of tms) {
    const code = ref('R', { kind: 'pengingat', id: t.id, label: t.label || t.kind, extra: { kind: t.kind } })
    out.push(`${code} · ${when(t.fire_at)} · ${t.kind === 'ingat' ? 'pengingat' : t.kind}${t.label ? ` · ${clip(t.label, 50)}` : ''}`)
  }

  const head = `Hari ini ${longDay(today)}. ${tasks.filter((t) => t.due_at && t.due_at < nowIso).length} tugas terlambat, ${tasks.length} tugas belum selesai.`
  const text = [head, ...out].join('\n')
  return { text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text, refs, accounts, categories }
}
