import Link from 'next/link'
import { CalendarClock, Clock, Flag, ListChecks, MapPin, Target } from 'lucide-react'
import { Badge } from '@/components/ui/display'
import { formatShort, formatTime } from '@/lib/format'
import { isoToDay } from '@/lib/dates'
import { PRIORITY, TASK_STATUS } from '@/lib/labels'
import type { Task } from '@/lib/types'
import { StatusSelect, TaskCheck } from './TaskForm'

export interface TaskMeta { subDone: number; subTotal: number; goalTitle?: string }

export function whenLabel(t: Task, tz: string, now = Date.now()) {
  if (t.kind === 'kegiatan' && t.start_at) {
    const sameDay = t.end_at && isoToDay(t.end_at, tz) === isoToDay(t.start_at, tz)
    return { text: `${formatShort(t.start_at, tz)}${t.end_at ? `–${sameDay ? formatTime(t.end_at, tz) : formatShort(t.end_at, tz)}` : ''}`, overdue: false }
  }
  if (t.due_at) {
    const overdue = new Date(t.due_at).getTime() < now && (t.status === 'belum' || t.status === 'dikerjakan' || t.status === 'tertunda')
    return { text: `${overdue ? 'Terlambat · ' : 'Tenggat '}${formatShort(t.due_at, tz)}`, overdue }
  }
  return null
}

export function TaskRow({ t, meta, tz }: { t: Task; meta?: TaskMeta; tz: string }) {
  const done = t.status === 'selesai'
  const when = whenLabel(t, tz)
  const st = TASK_STATUS[t.status]!
  const pr = PRIORITY[t.priority]!
  return (
    <li className={`task-row${done || t.status === 'dibatalkan' ? ' is-done' : ''}`}>
      {t.kind === 'tugas'
        ? <TaskCheck id={t.id} done={done} title={t.title} />
        : <span className="tint-icon" style={{ width: 22, height: 22, color: 'var(--c-lilac)' }} aria-hidden="true"><CalendarClock size={18} /></span>}
      <div className="min-w-0 flex-1">
        <Link href={`/tugas/${t.id}`} className="task-title block truncate hover:text-[var(--brand)]">{t.title}</Link>
        <div className="meta-row mt-1">
          {t.kind === 'kegiatan' && <span className="badge">Kegiatan</span>}
          {when && <span className={when.overdue ? 'overdue' : ''}><Clock size={13} aria-hidden="true" />{when.text}</span>}
          {t.location && <span><MapPin size={13} aria-hidden="true" />{t.location}</span>}
          {t.kind === 'tugas' && t.priority !== 'sedang' && <span><Flag size={13} aria-hidden="true" />{pr.label}</span>}
          {meta && meta.subTotal > 0 && <span><ListChecks size={13} aria-hidden="true" />{meta.subDone}/{meta.subTotal}</span>}
          {meta?.goalTitle && <span><Target size={13} aria-hidden="true" />{meta.goalTitle}</span>}
          {t.category && <span className="tag">{t.category}</span>}
        </div>
      </div>
      <div className="hidden sm:block shrink-0">
        {t.kind === 'tugas' ? <div className="w-40"><StatusSelect id={t.id} status={t.status} compact /></div> : <Badge tone={st.tone}>{st.label}</Badge>}
      </div>
    </li>
  )
}

export function TaskCard({ t, meta, tz }: { t: Task; meta?: TaskMeta; tz: string }) {
  const when = whenLabel(t, tz)
  const pr = PRIORITY[t.priority]!
  return (
    <article className="task-card">
      <div className="flex items-start gap-2">
        <TaskCheck id={t.id} done={t.status === 'selesai'} title={t.title} />
        <Link href={`/tugas/${t.id}`} className={`task-title flex-1 min-w-0 hover:text-[var(--brand)]${t.status === 'selesai' ? ' line-through text-[var(--text-muted)]' : ''}`}>{t.title}</Link>
      </div>
      <div className="meta-row">
        <Badge tone={pr.tone}>{pr.label}</Badge>
        {when && <span className={when.overdue ? 'overdue' : ''}><Clock size={13} aria-hidden="true" />{when.text}</span>}
        {meta && meta.subTotal > 0 && <span><ListChecks size={13} aria-hidden="true" />{meta.subDone}/{meta.subTotal}</span>}
      </div>
      {meta?.goalTitle && <p className="item-sub truncate"><Target size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />{meta.goalTitle}</p>}
      <StatusSelect id={t.id} status={t.status} compact />
    </article>
  )
}
