import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, Check, CheckSquare, Gauge, Milestone, NotebookPen, RotateCcw, Target, Trash2 } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { BackLink, DetailTitle, EmptyState, KpiCard, SectionHead } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { formatDay, formatNumber } from '@/lib/format'
import { JOURNAL_KIND, PROJECT_STATUS } from '@/lib/labels'
import { projectProgress } from '@/lib/projects'
import { loadLinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Project, ProjectMilestone, Task } from '@/lib/types'
import { NewJournalButton } from '../../jurnal/JournalForm'
import { NewTaskButton } from '../../tugas/TaskForm'
import { TaskRow, type TaskMeta } from '../../tugas/TaskItems'
import { deleteProject, setProjectStatus } from '../actions'
import { AddProjectMilestonesButton, EditProjectButton, ProjectMilestoneRow } from '../ProjectForms'

export const metadata: Metadata = { title: 'Detail proyek' }

const TASK_COLS = 'id, kind, title, description, category, priority, status, due_at, start_at, end_at, location, completed_at, goal_id, project_id, subject_id, recurrence, remind_before_minutes, created_at'

export default async function Page({ params }: PageProps<'/proyek/[id]'>) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const today = todayIn(tz)
  const supabase = await createClient()
  const [{ data: raw }, taskRes, msRes, journalRes, options] = await Promise.all([
    supabase.from('projects').select('id, title, description, status, goal_id, start_date, due_date, created_at, updated_at').eq('id', id).maybeSingle(),
    supabase.from('tasks').select(TASK_COLS).eq('project_id', id).order('status').order('due_at', { ascending: true, nullsFirst: false }).limit(300),
    supabase.from('project_milestones').select('id, project_id, title, due_date, completed_at, sort_order').eq('project_id', id).order('sort_order').order('created_at'),
    supabase.from('journal_entries').select('id, title, kind, entry_date').eq('project_id', id).order('entry_date', { ascending: false }).limit(20),
    loadLinkOptions(supabase),
  ])
  if (!raw) notFound()
  const p = raw as Project
  const tasks = (taskRes.data ?? []) as Task[]
  const milestones = (msRes.data ?? []) as ProjectMilestone[]
  const ids = tasks.map((t) => t.id)
  const { data: subs } = ids.length ? await supabase.from('task_subtasks').select('task_id, is_completed').in('task_id', ids) : { data: [] }
  const meta = new Map<string, TaskMeta>(tasks.map((t) => [t.id, { subDone: 0, subTotal: 0 }]))
  for (const s of subs ?? []) { const m = meta.get(s.task_id); if (m) { m.subTotal++; if (s.is_completed) m.subDone++ } }

  const counted = tasks.filter((t) => t.status !== 'dibatalkan')
  const t = { done: counted.filter((x) => x.status === 'selesai').length, total: counted.length }
  const m = { done: milestones.filter((x) => x.completed_at).length, total: milestones.length }
  const prog = projectProgress(t, m)
  const st = PROJECT_STATUS[p.status]!
  const goal = options.goals.find((g) => g.id === p.goal_id)
  const late = p.due_date && p.due_date < today && p.status !== 'selesai'

  return (
    <div className="page">
      <BackLink href="/proyek">Proyek Saya</BackLink>
      <div className="page-head">
        <DetailTitle title={p.title} status={st} desc={p.description}
          meta={[
            p.start_date || p.due_date ? `${p.start_date ? formatDay(p.start_date) : '…'} – ${p.due_date ? formatDay(p.due_date) : 'tanpa tenggat'}` : null,
            late ? <span className="overdue">Lewat tenggat</span> : null,
            goal ? <Link href={`/target/${goal.id}`} className="inline-flex items-center gap-1"><Target size={13} aria-hidden="true" />{goal.title}</Link> : null,
          ]} />
        <div className="control-row">
          {p.status === 'selesai' || p.status === 'arsip'
            ? <ActionButton action={setProjectStatus.bind(null, p.id, 'aktif')}><RotateCcw size={16} />Aktifkan lagi</ActionButton>
            : <ActionButton action={setProjectStatus.bind(null, p.id, 'selesai')} className="btn btn-primary"><Check size={16} />Tandai selesai</ActionButton>}
          <EditProjectButton goals={options.goals} initial={{ id: p.id, title: p.title, description: p.description, status: p.status, goal_id: p.goal_id, start_date: p.start_date ?? '', due_date: p.due_date ?? '' }} />
          {p.status !== 'arsip' && <ActionButton action={setProjectStatus.bind(null, p.id, 'arsip')}><Archive size={16} />Arsipkan</ActionButton>}
          <ConfirmButton action={deleteProject.bind(null, p.id)} redirect="/proyek" title="Hapus proyek?"
            message={`"${p.title}" beserta tahapannya dihapus. Tugas dan catatan yang tertaut tetap ada, hanya tautannya dilepas.`}
            className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus proyek"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="kpis kpis-3">
        <KpiCard label="Progres" value={null} display={`${formatNumber(Math.floor(prog.pct))}%`} icon={<Gauge size={20} strokeWidth={1.9} />} color="var(--c-blue)"
          caption={prog.source ? `Dihitung dari ${prog.source}` : 'Tambahkan tugas atau tahapan'} progress={prog.source ? prog.pct : undefined} />
        <KpiCard label="Tugas selesai" value={null} display={`${t.done}/${t.total}`} icon={<CheckSquare size={20} strokeWidth={1.9} />} color="var(--c-lilac)"
          caption={t.total ? `${t.total - t.done} tugas tersisa` : 'Belum ada tugas proyek'} progress={t.total ? (t.done / t.total) * 100 : undefined} />
        <KpiCard label="Tahapan" value={null} display={`${m.done}/${m.total}`} icon={<Milestone size={20} strokeWidth={1.9} />} color="var(--c-peach)"
          caption={m.total ? `${m.total - m.done} tahapan tersisa` : 'Belum ada tahapan'} progress={m.total ? (m.done / m.total) * 100 : undefined} />
      </div>

      <div className="row-2" style={{ alignItems: 'start' }}>
        <section className="card" aria-labelledby="ptask-title">
          <SectionHead id="ptask-title" icon={<CheckSquare size={18} />} title="Tugas proyek" desc="Tugas yang ditautkan ke proyek ini">
            <NewTaskButton options={options} preset={{ project_id: p.id, goal_id: p.goal_id }} label="Tugas" className="btn btn-secondary btn-sm" />
          </SectionHead>
          {tasks.length === 0 ? (
            <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />} title="Belum ada tugas" description="Tambahkan tugas dari sini, atau pilih proyek ini saat membuat tugas." />
          ) : (
            <ul className="items">{tasks.map((x) => <TaskRow key={x.id} t={x} meta={meta.get(x.id)} tz={tz} />)}</ul>
          )}
        </section>

        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="pms-title">
            <SectionHead id="pms-title" icon={<Milestone size={18} />} title="Tahapan" desc={m.total ? `${m.done} dari ${m.total} selesai` : 'Langkah besar menuju rampung'}>
              <AddProjectMilestonesButton projectId={p.id} />
            </SectionHead>
            {milestones.length === 0 ? (
              <EmptyState icon={<Milestone size={20} strokeWidth={1.75} />} title="Belum ada tahapan" description="Mis. Riset, Pengembangan, Uji coba, Rilis." />
            ) : (
              <div className="card-body pt-2">
                <ul className="items">{milestones.map((x) => <ProjectMilestoneRow key={x.id} m={x} projectId={p.id} dueLabel={x.due_date ? formatDay(x.due_date) : null} />)}</ul>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="pnote-title">
            <SectionHead id="pnote-title" icon={<NotebookPen size={18} />} title="Catatan proyek" desc="Catatan rapat, ide, dan dokumentasi">
              <NewJournalButton today={today} goals={options.goals} subjects={options.subjects} projects={options.projects}
                preset={{ project_id: p.id, kind: 'pekerjaan' }} label="Catatan" className="btn btn-secondary btn-sm" />
            </SectionHead>
            {(journalRes.data ?? []).length === 0 ? (
              <EmptyState icon={<NotebookPen size={20} strokeWidth={1.75} />} title="Belum ada catatan" />
            ) : (
              <div className="card-body pt-2">
                <ul className="items">{(journalRes.data ?? []).map((j) => (
                  <li key={j.id} className="item">
                    <Link href={`/jurnal/${j.id}`} className="min-w-0 flex-1">
                      <span className="item-title block truncate">{j.title || 'Tanpa judul'}</span>
                      <span className="item-sub">{JOURNAL_KIND[j.kind]?.label} · {formatDay(j.entry_date)}</span>
                    </Link>
                  </li>
                ))}</ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
