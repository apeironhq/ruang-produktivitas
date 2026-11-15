import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, CalendarClock, CheckCircle2, CheckSquare, Clock, NotebookPen, Target } from 'lucide-react'
import { DonutChart, EmptyState, KpiCard, ProgressBar, tint } from '@/components/ui/display'
import { TrendChart } from '@/components/ui/charts'
import { ParamSelect } from '@/components/ui/filters'
import { addDays, dayRange, isoToDay, startOfDayIso, todayIn } from '@/lib/dates'
import { formatDayLong, formatDuration, formatNumber, formatShort, formatTime } from '@/lib/format'
import { OPEN_STATUSES, TASK_STATUS } from '@/lib/labels'
import { GOAL_COLUMNS, loadProgress, mergeProgress } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Goal, Task } from '@/lib/types'
import { str } from '@/lib/url'
import { QuickAddButton } from '@/components/shell/QuickAdd'
import { SessionButton, type SubjectBundle } from './belajar/LearningForms'
import { NewGoalButton } from './target/GoalForm'
import { goalNumbers } from './target/GoalCard'
import { TaskCheck } from './tugas/TaskForm'

export const metadata: Metadata = { title: 'Beranda' }

const C = { blue: '#2563eb', peach: '#b85c22', lilac: '#6a53b8', rose: '#d4547e' }

export default async function Page({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const supabase = await createClient()
  const days = [7, 14, 30].includes(Number(str(sp.hari))) ? Number(str(sp.hari)) : 14

  const today = todayIn(tz)
  const from = addDays(today, -Math.max(days, 14) + 1) // cukup untuk KPI (14 hari) & grafik
  const fromIso = startOfDayIso(from, tz)
  const tomorrowIso = startOfDayIso(addDays(today, 1), tz)
  const nowIso = new Date().toISOString()

  const [doneRes, sessRes, journRes, goalsRes, agendaRes, statusRes, recentSess, recentJ, recentT, subjectsRes, sourcesRes, modulesRes, progress] = await Promise.all([
    supabase.from('tasks').select('completed_at').gte('completed_at', fromIso),
    supabase.from('learning_sessions').select('session_date, duration_minutes').gte('session_date', from),
    supabase.from('journal_entries').select('entry_date').gte('entry_date', from),
    supabase.from('goals').select(GOAL_COLUMNS).eq('status', 'aktif').order('priority', { ascending: false }).order('due_date', { ascending: true, nullsFirst: false }).limit(20),
    supabase.from('tasks').select('id, kind, title, status, priority, due_at, start_at, end_at, location')
      .in('status', [...OPEN_STATUSES])
      .or(`and(kind.eq.tugas,due_at.lt.${tomorrowIso}),and(start_at.gte.${startOfDayIso(today, tz)},start_at.lt.${tomorrowIso})`)
      .order('due_at', { ascending: true, nullsFirst: false }).order('start_at', { ascending: true }).limit(30),
    supabase.from('tasks').select('status').limit(5000),
    supabase.from('learning_sessions').select('id, subject_id, material, duration_minutes, created_at').order('created_at', { ascending: false }).limit(6),
    supabase.from('journal_entries').select('id, title, kind, created_at').order('created_at', { ascending: false }).limit(6),
    supabase.from('tasks').select('id, title, completed_at').not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(6),
    supabase.from('learning_subjects').select('id, title').eq('status', 'aktif').order('updated_at', { ascending: false }),
    supabase.from('learning_sources').select('id, subject_id, title, position'),
    supabase.from('learning_modules').select('id, subject_id, title, completed_at').eq('is_applicable', true).order('sort_order'),
    loadProgress(supabase),
  ])

  // ----- KPI: 7 hari terakhir vs 7 hari sebelumnya -----
  const week = dayRange(addDays(today, -6), today)
  const weekStart = week[0]!
  const prevStart = addDays(today, -13)
  const series = (pairs: Array<[string, number]>) => {
    const map = new Map(week.map((d) => [d, 0]))
    let cur = 0, prev = 0
    for (const [d, v] of pairs) {
      if (d >= weekStart) { cur += v; map.set(d, (map.get(d) ?? 0) + v) } else if (d >= prevStart) prev += v
    }
    return { cur, prev, values: week.map((d) => map.get(d) ?? 0) }
  }
  const kTasks = series((doneRes.data ?? []).map((t) => [isoToDay(t.completed_at!, tz), 1]))
  const kLearn = series((sessRes.data ?? []).map((s) => [s.session_date, s.duration_minutes]))
  const kNotes = series((journRes.data ?? []).map((j) => [j.entry_date, 1]))

  const goals = mergeProgress((goalsRes.data ?? []) as Goal[], progress)
  const avg = goals.length ? goals.reduce((n, g) => n + g.percent, 0) / goals.length : 0

  // ----- Grafik tren belajar -----
  const trendDays = dayRange(addDays(today, -days + 1), today)
  const minutes = new Map(trendDays.map((d) => [d, 0]))
  const sessionsPerDay = new Map<string, number>()
  for (const s of sessRes.data ?? []) {
    if (minutes.has(s.session_date)) {
      minutes.set(s.session_date, minutes.get(s.session_date)! + s.duration_minutes)
      sessionsPerDay.set(s.session_date, (sessionsPerDay.get(s.session_date) ?? 0) + 1)
    }
  }
  const trend = trendDays.map((d) => ({ date: d, value: minutes.get(d) ?? 0, extra: sessionsPerDay.get(d) ? `${sessionsPerDay.get(d)} sesi` : '' }))
  const trendTotal = trend.reduce((n, p) => n + p.value, 0)

  // ----- Status tugas -----
  const statusCount: Record<string, number> = { belum: 0, dikerjakan: 0, tertunda: 0, selesai: 0, dibatalkan: 0 }
  for (const t of statusRes.data ?? []) statusCount[t.status] = (statusCount[t.status] ?? 0) + 1
  const segments = [
    { label: 'Belum dimulai', value: statusCount.belum!, color: '#98a2b3' },
    { label: 'Dikerjakan', value: statusCount.dikerjakan!, color: C.blue },
    { label: 'Tertunda', value: statusCount.tertunda!, color: C.peach },
    { label: 'Selesai', value: statusCount.selesai!, color: C.lilac },
  ]

  // ----- Agenda hari ini -----
  const agenda = (agendaRes.data ?? []) as Task[]
  const overdueCount = agenda.filter((t) => t.kind === 'tugas' && t.due_at && t.due_at < startOfDayIso(today, tz)).length

  // ----- Aktivitas terbaru -----
  const subjectTitle = new Map((subjectsRes.data ?? []).map((s) => [s.id, s.title]))
  const activity = [
    ...(recentSess.data ?? []).map((s) => ({ at: s.created_at, title: `Belajar ${formatDuration(s.duration_minutes)}`, sub: [subjectTitle.get(s.subject_id), s.material].filter(Boolean).join(' · ') || 'Sesi belajar', href: `/belajar/${s.subject_id}`, icon: <BookOpen size={17} />, color: C.peach })),
    ...(recentJ.data ?? []).map((j) => ({ at: j.created_at, title: 'Catatan ditulis', sub: j.title || 'Tanpa judul', href: `/jurnal/${j.id}`, icon: <NotebookPen size={17} />, color: C.rose })),
    ...(recentT.data ?? []).map((t) => ({ at: t.completed_at!, title: 'Tugas selesai', sub: t.title, href: `/tugas/${t.id}`, icon: <CheckCircle2 size={17} />, color: C.blue })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)

  const bundles: SubjectBundle[] = (subjectsRes.data ?? []).map((s) => ({
    id: s.id, title: s.title,
    sources: (sourcesRes.data ?? []).filter((x) => x.subject_id === s.id),
    modules: (modulesRes.data ?? []).filter((m) => m.subject_id === s.id),
  }))
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date()))
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Beranda</h1>
          <p className="text-caption">{greet}, {user.displayName}. {formatDayLong(today)}.</p>
        </div>
        <div className="control-row">
          <QuickAddButton kind="tugas" label="Tugas" />
          <QuickAddButton kind="catatan" label="Catatan" />
          <NewGoalButton today={today} label="Target" className="btn btn-secondary" />
          <SessionButton subjects={bundles} today={today} label="Catat belajar" />
        </div>
      </div>

      <div className="kpis kpis-4">
        <KpiCard label="Tugas selesai" value={kTasks.cur} icon={<CheckSquare size={20} strokeWidth={1.9} />} color={C.blue} href="/tugas?tab=selesai"
          series={kTasks.values} thisWeek={kTasks.cur} lastWeek={kTasks.prev} />
        <KpiCard label="Waktu belajar" value={kLearn.cur} display={formatDuration(kLearn.cur)} icon={<Clock size={20} strokeWidth={1.9} />} color={C.peach} href="/belajar"
          series={kLearn.values} thisWeek={kLearn.cur} lastWeek={kLearn.prev} />
        <KpiCard label="Target aktif" value={goals.length} icon={<Target size={20} strokeWidth={1.9} />} color={C.lilac} href="/target"
          caption={goals.length ? `Rata-rata progres ${formatNumber(Math.round(avg))}%` : 'Belum ada target aktif'} />
        <KpiCard label="Catatan ditulis" value={kNotes.cur} icon={<NotebookPen size={20} strokeWidth={1.9} />} color={C.rose} href="/jurnal"
          series={kNotes.values} thisWeek={kNotes.cur} lastWeek={kNotes.prev} />
      </div>

      <div className="row-2">
        <section className="card panel" aria-labelledby="trend-title">
          <div className="panel-head">
            <div>
              <h2 id="trend-title">Aktivitas belajar</h2>
              <p className="text-caption">{formatDuration(trendTotal)} belajar dalam {days} hari terakhir</p>
            </div>
            <ParamSelect param="hari" label="Rentang waktu" className="w-40" options={[{ value: '7', label: '7 hari terakhir' }, { value: '', label: '14 hari terakhir' }, { value: '30', label: '30 hari terakhir' }]} />
          </div>
          <div className="panel-body"><TrendChart points={trend} label="Menit belajar" unit="menit" color={C.peach} /></div>
        </section>
        <section className="card panel" aria-labelledby="status-title">
          <div className="panel-head">
            <div><h2 id="status-title">Status tugas</h2><p className="text-caption">Sebaran seluruh tugas & kegiatan</p></div>
          </div>
          <div className="panel-body center"><DonutChart segments={segments} centerLabel="Tugas" /></div>
        </section>
      </div>

      <div className="row-3">
        <section className="card panel" aria-labelledby="today-title">
          <div className="panel-head">
            <div><h2 id="today-title">Hari ini</h2><p className="text-caption">{overdueCount ? `${overdueCount} terlambat · ` : ''}Tenggat & jadwal hari ini</p></div>
            <Link href="/tugas?tab=hari-ini" className="link-sm">Lihat semua</Link>
          </div>
          <div className="panel-body">
            {agenda.length === 0 ? <EmptyState icon={<CalendarClock size={20} strokeWidth={1.75} />} title="Tidak ada agenda" description="Tugas jatuh tempo dan kegiatan hari ini muncul di sini." className="fill" /> : (
              <ul className="items">
                {agenda.map((t) => {
                  const late = t.kind === 'tugas' && t.due_at && t.due_at < nowIso
                  return (
                    <li key={t.id} className="item">
                      {t.kind === 'tugas' ? <TaskCheck id={t.id} done={false} title={t.title} />
                        : <span className="act-icon" style={{ ...tint(C.lilac), width: 22, height: 22 }} aria-hidden="true"><CalendarClock size={13} /></span>}
                      <Link href={`/tugas/${t.id}`} className="min-w-0 flex-1">
                        <span className="item-title block truncate">{t.title}</span>
                        <span className={`item-sub block truncate${late ? ' overdue' : ''}`}>
                          {t.kind === 'kegiatan' && t.start_at ? `${formatTime(t.start_at, tz)}${t.end_at ? `–${formatTime(t.end_at, tz)}` : ''}${t.location ? ` · ${t.location}` : ''}`
                            : t.due_at ? `${late ? 'Terlambat · ' : 'Tenggat '}${formatShort(t.due_at, tz)}` : ''}
                        </span>
                      </Link>
                      <span className={`badge badge-dot ${TASK_STATUS[t.status]!.tone}`}>{TASK_STATUS[t.status]!.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="card panel" aria-labelledby="goals-title">
          <div className="panel-head">
            <div><h2 id="goals-title">Target aktif</h2><p className="text-caption">Progres dihitung dari data</p></div>
            <Link href="/target" className="link-sm">Lihat semua</Link>
          </div>
          <div className="panel-body">
            {goals.length === 0 ? <EmptyState icon={<Target size={20} strokeWidth={1.75} />} title="Belum ada target" description="Mis. Tabungan Rp100 juta atau 10 modul Next.js." className="fill" action={<NewGoalButton today={today} className="btn btn-secondary btn-sm" />} /> : (
              <ul className="items">
                {goals.slice(0, 8).map((g) => {
                  const n = goalNumbers(g)
                  return (
                    <li key={g.id} className="item">
                      <Link href={`/target/${g.id}`} className="min-w-0 flex-1">
                        <span className="item-row"><span className="item-title truncate">{g.title}</span><span className="item-meta">{formatNumber(g.percent)}%</span></span>
                        <ProgressBar percent={g.percent} label={`Progres ${g.title}`} />
                        <span className="item-sub block truncate">{n.current} dari {n.target}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="card panel" aria-labelledby="act-title">
          <div className="panel-head">
            <div><h2 id="act-title">Aktivitas terbaru</h2><p className="text-caption">Sesi belajar, catatan, dan tugas selesai</p></div>
          </div>
          <div className="panel-body">
            {activity.length === 0 ? <EmptyState title="Belum ada aktivitas" description="Aktivitas akan muncul di sini." className="fill" /> : (
              <ul className="items">
                {activity.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="item">
                    <span className="act-icon" style={tint(a.color)} aria-hidden="true">{a.icon}</span>
                    <Link href={a.href} className="min-w-0 flex-1">
                      <span className="item-title block truncate">{a.title}</span>
                      <span className="item-sub block truncate">{a.sub}</span>
                    </Link>
                    <span className="item-meta">{formatShort(a.at, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
