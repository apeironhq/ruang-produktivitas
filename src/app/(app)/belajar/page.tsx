import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, CheckCircle2, Clock, Layers } from 'lucide-react'
import { Badge, EmptyState, KpiCard, PageHead, ProgressBar, SectionHead } from '@/components/ui/display'
import { addDays, dayRange, todayIn } from '@/lib/dates'
import { formatDay, formatDuration, formatNumber } from '@/lib/format'
import { SUBJECT_STATUS } from '@/lib/labels'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Module, Option, Session, Source, Subject } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { NewSubjectButton, SessionButton, type SubjectBundle } from './LearningForms'

export const metadata: Metadata = { title: 'Ruang Belajar' }

export default async function Page({ searchParams }: PageProps<'/belajar'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const showArchived = str(sp.tab) === 'arsip'
  const today = todayIn(user.timezone)
  const from14 = addDays(today, -13)

  const [subjectsRes, modulesRes, sourcesRes, sessionsRes, goalsRes, lastRes] = await Promise.all([
    supabase.from('learning_subjects').select('id, title, description, status, goal_id, created_at, updated_at').order('updated_at', { ascending: false }),
    supabase.from('learning_modules').select('id, subject_id, title, sort_order, is_applicable, completed_at').order('sort_order'),
    supabase.from('learning_sources').select('id, subject_id, title, position').order('updated_at', { ascending: false }),
    supabase.from('learning_sessions').select('subject_id, session_date, duration_minutes').gte('session_date', from14),
    supabase.from('goals').select('id, title').neq('status', 'arsip').order('created_at', { ascending: false }),
    supabase.from('learning_sessions').select('subject_id, session_date, material').order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
  ])
  const subjects = (subjectsRes.data ?? []) as Subject[]
  const modules = (modulesRes.data ?? []) as Module[]
  const sources = (sourcesRes.data ?? []) as Pick<Source, 'id' | 'subject_id' | 'title' | 'position'>[]
  const recent = (sessionsRes.data ?? []) as Pick<Session, 'subject_id' | 'session_date' | 'duration_minutes'>[]
  const goals = (goalsRes.data ?? []) as Option[]

  const lastSession = new Map<string, { date: string; material: string }>()
  for (const s of lastRes.data ?? []) if (!lastSession.has(s.subject_id)) lastSession.set(s.subject_id, { date: s.session_date, material: s.material })

  // KPI 7 hari vs 7 hari sebelumnya
  const days = dayRange(addDays(today, -6), today)
  const minutesByDay = new Map(days.map((d) => [d, 0]))
  let thisWeek = 0, lastWeek = 0, sessionsWeek = 0, sessionsPrev = 0
  const sessionsByDay = new Map(days.map((d) => [d, 0]))
  for (const s of recent) {
    if (s.session_date >= days[0]!) { thisWeek += s.duration_minutes; sessionsWeek++; minutesByDay.set(s.session_date, (minutesByDay.get(s.session_date) ?? 0) + s.duration_minutes); sessionsByDay.set(s.session_date, (sessionsByDay.get(s.session_date) ?? 0) + 1) }
    else { lastWeek += s.duration_minutes; sessionsPrev++ }
  }
  const applicable = modules.filter((m) => m.is_applicable)
  const doneModules = applicable.filter((m) => m.completed_at).length

  const active = subjects.filter((s) => s.status !== 'arsip')
  const shown = showArchived ? subjects.filter((s) => s.status === 'arsip') : active
  const bundles: SubjectBundle[] = active.map((s) => ({
    id: s.id, title: s.title,
    sources: sources.filter((x) => x.subject_id === s.id),
    modules: modules.filter((m) => m.subject_id === s.id && m.is_applicable),
  }))
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]))

  return (
    <div className="page">
      <PageHead title="Ruang Belajar" description="Bidang belajar, sumber, modul, dan riwayat sesi — semua progres dihitung dari data."
        actions={<><NewSubjectButton goals={goals} className="btn btn-secondary" /><SessionButton subjects={bundles} today={today} /></>} />

      <div className="kpis kpis-4 kpis-summary">
        <KpiCard label="Bidang aktif" value={subjects.filter((s) => s.status === 'aktif').length} icon={<BookOpen size={20} strokeWidth={1.9} />} color="var(--c-blue)" caption={`${subjects.filter((s) => s.status === 'selesai').length} dari ${subjects.filter((s) => s.status !== 'arsip').length} bidang selesai`}
          progress={subjects.some((s) => s.status !== 'arsip') ? (subjects.filter((s) => s.status === 'selesai').length / subjects.filter((s) => s.status !== 'arsip').length) * 100 : 0} />
        <KpiCard label="Waktu belajar" duration value={thisWeek} display={formatDuration(thisWeek)} icon={<Clock size={20} strokeWidth={1.9} />} color="var(--c-peach)" series={days.map((d) => minutesByDay.get(d) ?? 0)} thisWeek={thisWeek} lastWeek={lastWeek} />
        <KpiCard label="Sesi 7 hari" value={sessionsWeek} icon={<Layers size={20} strokeWidth={1.9} />} color="var(--c-lilac)" series={days.map((d) => sessionsByDay.get(d) ?? 0)} thisWeek={sessionsWeek} lastWeek={sessionsPrev} />
        <KpiCard label="Modul selesai" value={doneModules} icon={<CheckCircle2 size={20} strokeWidth={1.9} />} color="var(--c-rose)" caption={`dari ${formatNumber(applicable.length)} modul`} progress={applicable.length ? (doneModules / applicable.length) * 100 : undefined} />
      </div>

      <nav className="tabs" aria-label="Saring bidang">
        <Link href={hrefWith('/belajar', sp, { tab: null })} className={`tab${!showArchived ? ' active' : ''}`}>Aktif & selesai<span className="tab-count">{active.length}</span></Link>
        <Link href={hrefWith('/belajar', sp, { tab: 'arsip' })} className={`tab${showArchived ? ' active' : ''}`}>Diarsipkan<span className="tab-count">{subjects.length - active.length}</span></Link>
      </nav>

      <section className="card" aria-labelledby="subj-title">
        <SectionHead id="subj-title" icon={<BookOpen size={18} />} title="Bidang belajar" desc="Progres = modul selesai ÷ modul yang berlaku">
          {shown.length > 0 && <span className="badge">{shown.length} bidang</span>}
        </SectionHead>
      {shown.length === 0 ? (
          <EmptyState icon={<BookOpen size={20} strokeWidth={1.75} />} title={showArchived ? 'Tidak ada bidang diarsipkan' : 'Belum ada bidang belajar'}
            description={showArchived ? undefined : 'Mulai dengan satu bidang, mis. "Next.js", lalu tambahkan modul dan sumbernya.'}
            action={showArchived ? undefined : <NewSubjectButton goals={goals} />} />
      ) : (
        <div className="card-body"><div className="grid-cards">
          {shown.map((s) => {
            const ms = modules.filter((m) => m.subject_id === s.id && m.is_applicable)
            const done = ms.filter((m) => m.completed_at).length
            const pct = ms.length ? (done / ms.length) * 100 : 0
            const last = lastSession.get(s.id)
            const src = sources.filter((x) => x.subject_id === s.id)
            const st = SUBJECT_STATUS[s.status]!
            return (
              <Link key={s.id} href={`/belajar/${s.id}`} className="card kpi clickable">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate">{s.title}</h3>
                    <p className="item-sub truncate mt-0.5">{s.goal_id && goalTitle.get(s.goal_id) ? `Target: ${goalTitle.get(s.goal_id)}` : `${src.length} sumber`}</p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="kpi-value text-[1.5rem]">{Math.round(pct)}%</span>
                    <span className="item-sub">{done} dari {ms.length} modul</span>
                  </div>
                  <ProgressBar percent={pct} label={`Progres ${s.title}`} />
                </div>
                <p className="item-sub truncate">{last ? `Terakhir ${formatDay(last.date)}${last.material ? ` · ${last.material}` : ''}` : 'Belum ada sesi belajar'}</p>
              </Link>
            )
          })}
        </div></div>
      )}
      </section>
    </div>
  )
}
