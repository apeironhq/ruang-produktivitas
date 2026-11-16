import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlignLeft, Info, ListChecks, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ui/actions'
import { BackLink, DetailTitle, EmptyState, InfoList, ProgressBar, SectionHead } from '@/components/ui/display'
import { formatDateTime } from '@/lib/format'
import { PRIORITY, RECURRENCE, TASK_KIND, displayStatus, remindLabel } from '@/lib/labels'
import { loadLinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Subtask, Task } from '@/lib/types'
import { deleteTask } from '../actions'
import { EditTaskButton, StatusSelect } from '../TaskForm'
import { taskFormValues, whenLabel } from '../TaskItems'
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
  const t = task as Task & { reminded_at: string | null }
  const subtasks = (subs ?? []) as Subtask[]
  const done = subtasks.filter((s) => s.is_completed).length
  const goal = options.goals.find((g) => g.id === t.goal_id)
  const subject = options.subjects.find((s) => s.id === t.subject_id)
  const project = options.projects.find((p) => p.id === t.project_id)
  const when = whenLabel(t, tz)
  const initial = taskFormValues(t, tz)

  return (
    <div className="page">
      <BackLink href="/tugas">Tugas & Kegiatan</BackLink>
      <div className="page-head">
        <DetailTitle title={t.title} status={displayStatus(t)}
          meta={[TASK_KIND[t.kind], when ? <span className={when.overdue ? 'overdue' : ''}>{when.text}</span> : null, t.kind === 'tugas' ? `Prioritas ${PRIORITY[t.priority]!.label.toLowerCase()}` : t.location || null, RECURRENCE[t.recurrence]?.short ? `Berulang ${RECURRENCE[t.recurrence]!.short.toLowerCase()}` : null]} />
        <div className="control-row">
          <EditTaskButton initial={initial} options={options} />
          <ConfirmButton action={deleteTask.bind(null, t.id)} redirect="/tugas" title={`Hapus ${TASK_KIND[t.kind]!.toLowerCase()}?`}
            message={`"${t.title}" beserta subtugasnya akan dihapus permanen.`} className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="row-2" style={{ alignItems: 'start' }}>
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

        <section className="card h-fit detail-aside" aria-labelledby="info-title">
          <SectionHead id="info-title" icon={<Info size={18} />} title="Informasi" />
          <div className="card-body flex flex-col gap-5">
            <div className="field">
              <span className="field-label">Status</span>
              <StatusSelect id={t.id} status={t.status} />
            </div>
            <InfoList items={[
              t.kind === 'tugas' ? ['Prioritas', PRIORITY[t.priority]!.label] : null,
              ['Kategori', t.category || '—'],
              t.kind === 'tugas'
                ? ['Tenggat', t.due_at ? formatDateTime(t.due_at, tz) : '—']
                : ['Mulai', formatDateTime(t.start_at, tz)],
              t.kind === 'kegiatan' && t.end_at ? ['Selesai', formatDateTime(t.end_at, tz)] : null,
              t.kind === 'kegiatan' ? ['Lokasi', t.location || '—'] : null,
              ['Ulangi', RECURRENCE[t.recurrence]?.label ?? '—'],
              ['Pengingat', remindLabel(t.remind_before_minutes) ?? '—'],
              t.reminded_at ? ['Pengingat terkirim', formatDateTime(t.reminded_at, tz)] : null,
              t.completed_at ? ['Selesai pada', formatDateTime(t.completed_at, tz)] : null,
              goal ? ['Target', <Link key="g" href={`/target/${goal.id}`}>{goal.title}</Link>] : null,
              subject ? ['Bidang belajar', <Link key="s" href={`/belajar/${subject.id}`}>{subject.title}</Link>] : null,
              project ? ['Proyek', <Link key="p" href={`/proyek/${project.id}`}>{project.title}</Link>] : null,
              ['Dibuat', formatDateTime(t.created_at, tz)],
            ]} />
          </div>
        </section>
      </div>
    </div>
  )
}
