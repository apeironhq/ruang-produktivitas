import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlignLeft, Info, ListChecks, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ui/actions'
import { BackLink, Badge, EmptyState, ProgressBar, SectionHead } from '@/components/ui/display'
import { isoToLocalInput } from '@/lib/dates'
import { formatDateTime } from '@/lib/format'
import { PRIORITY, TASK_KIND, displayStatus } from '@/lib/labels'
import { loadLinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Subtask, Task } from '@/lib/types'
import { deleteTask } from '../actions'
import { EditTaskButton, StatusSelect, type TaskFormValues } from '../TaskForm'
import { whenLabel } from '../TaskItems'
import { AddSubtaskButton, Subtasks } from './Subtasks'

export const metadata: Metadata = { title: 'Detail tugas' }

export default async function Page({ params }: PageProps<'/tugas/[id]'>) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const supabase = await createClient()
  const [{ data: task }, { data: subs }, options] = await Promise.all([
    supabase.from('tasks').select('*').eq('id', id).maybeSingle(),
    supabase.from('task_subtasks').select('id, task_id, title, is_completed, sort_order').eq('task_id', id).order('sort_order').order('created_at'),
    loadLinkOptions(supabase),
  ])
  if (!task) notFound()
  const t = task as Task
  const subtasks = (subs ?? []) as Subtask[]
  const done = subtasks.filter((s) => s.is_completed).length
  const goal = options.goals.find((g) => g.id === t.goal_id)
  const subject = options.subjects.find((s) => s.id === t.subject_id)
  const project = options.projects.find((p) => p.id === t.project_id)
  const when = whenLabel(t, tz)
  const initial: TaskFormValues = {
    id: t.id, kind: t.kind, title: t.title, description: t.description, category: t.category, priority: t.priority, status: t.status,
    due_local: isoToLocalInput(t.due_at, tz), start_local: isoToLocalInput(t.start_at, tz), end_local: isoToLocalInput(t.end_at, tz),
    location: t.location, goal_id: t.goal_id, project_id: t.project_id, subject_id: t.subject_id,
  }

  return (
    <div className="page">
      <BackLink href="/tugas">Tugas & Kegiatan</BackLink>
      <div className="page-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="badge">{TASK_KIND[t.kind]}</span>
            <Badge tone={displayStatus(t).tone}>{displayStatus(t).label}</Badge>
          </div>
          <h1 className="break-words">{t.title}</h1>
          {when && <p className={`text-caption mt-1${when.overdue ? ' overdue' : ''}`}>{when.text}</p>}
        </div>
        <div className="control-row">
          <EditTaskButton initial={initial} options={options} />
          <ConfirmButton action={deleteTask.bind(null, t.id)} redirect="/tugas" title={`Hapus ${TASK_KIND[t.kind]!.toLowerCase()}?`}
            message={`"${t.title}" beserta subtugasnya akan dihapus permanen.`} className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="row-2">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="desc-title">
            <SectionHead id="desc-title" icon={<AlignLeft size={18} />} title="Deskripsi" />
            <div className="card-body">
              {t.description ? <p className="prose-plain">{t.description}</p> : <p className="text-caption">Belum ada deskripsi.</p>}
            </div>
          </section>
          {t.kind === 'tugas' && (
            <section className="card" aria-labelledby="sub-title">
              <SectionHead id="sub-title" icon={<ListChecks size={18} />} title="Subtugas"
                desc={subtasks.length ? `${done} dari ${subtasks.length} selesai` : 'Pecah tugas menjadi langkah kecil.'}>
                <AddSubtaskButton taskId={t.id} />
              </SectionHead>
              {subtasks.length === 0 ? <EmptyState icon={<ListChecks size={20} strokeWidth={1.75} />} title="Belum ada subtugas" description="Tambahkan langkah-langkah kecil untuk tugas ini." /> : (
                <div className="card-body pt-3">
                  <div className="mb-2"><ProgressBar percent={(done / subtasks.length) * 100} label="Progres subtugas" /></div>
                  <Subtasks taskId={t.id} items={subtasks} />
                </div>
              )}
            </section>
          )}
        </div>

        <section className="card h-fit" aria-labelledby="info-title">
          <SectionHead id="info-title" icon={<Info size={18} />} title="Informasi" />
          <div className="card-body flex flex-col gap-5">
            <div className="field">
              <span className="field-label">Status</span>
              <StatusSelect id={t.id} status={t.status} />
            </div>
            <dl className="dl">
              <div><dt>Prioritas</dt><dd>{PRIORITY[t.priority]!.label}</dd></div>
              <div><dt>Kategori</dt><dd>{t.category || '—'}</dd></div>
              {t.kind === 'tugas'
                ? <div><dt>Tenggat</dt><dd>{formatDateTime(t.due_at, tz)}</dd></div>
                : <div><dt>Jadwal</dt><dd>{formatDateTime(t.start_at, tz)}{t.end_at ? ` – ${formatDateTime(t.end_at, tz)}` : ''}</dd></div>}
              {t.kind === 'kegiatan' && <div><dt>Lokasi</dt><dd>{t.location || '—'}</dd></div>}
              <div><dt>Selesai pada</dt><dd>{formatDateTime(t.completed_at, tz)}</dd></div>
              <div><dt>Dibuat</dt><dd>{formatDateTime(t.created_at, tz)}</dd></div>
              <div><dt>Target</dt><dd>{goal ? <Link className="link" href={`/target/${goal.id}`}>{goal.title}</Link> : '—'}</dd></div>
              <div><dt>Bidang belajar</dt><dd>{subject ? <Link className="link" href={`/belajar/${subject.id}`}>{subject.title}</Link> : '—'}</dd></div>
              {project && <div><dt>Proyek</dt><dd>{project.title}</dd></div>}
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}
