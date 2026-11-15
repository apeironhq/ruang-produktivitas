'use client'

import { Check, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { useRunAction } from '@/components/ui/actions'
import { SubmitButton, useFormAction } from '@/components/ui/forms'
import type { Subtask } from '@/lib/types'
import { addSubtask, deleteSubtask, toggleSubtask } from '../actions'

export function Subtasks({ taskId, items }: { taskId: string; items: Subtask[] }) {
  const form = useRef<HTMLFormElement | null>(null)
  const { formAction, errors } = useFormAction(addSubtask, { silent: true, onSuccess: () => form.current?.reset() })
  return (
    <div>
      {items.length > 0 && (
        <ul className="items mb-3">
          {items.map((s) => <SubtaskRow key={s.id} s={s} taskId={taskId} />)}
        </ul>
      )}
      <form ref={form} action={formAction} className="flex gap-2" noValidate>
        <input type="hidden" name="task_id" value={taskId} />
        <label htmlFor="new-subtask" className="sr-only">Subtugas baru</label>
        <input id="new-subtask" name="title" className={`input${errors.title ? ' has-error' : ''}`} placeholder="Tambah subtugas…" maxLength={200} required />
        <SubmitButton variant="secondary" loadingText="…"><Plus size={16} /><span className="hidden sm:inline">Tambah</span></SubmitButton>
      </form>
      {errors.title && <p className="field-error mt-1">{errors.title}</p>}
    </div>
  )
}

function SubtaskRow({ s, taskId }: { s: Subtask; taskId: string }) {
  const { pending, run } = useRunAction()
  return (
    <li className={`item${s.is_completed ? ' is-done' : ''}`}>
      <button type="button" className={`task-check${s.is_completed ? ' done' : ''}`} disabled={pending} aria-pressed={s.is_completed}
        aria-label={s.is_completed ? `Buka lagi: ${s.title}` : `Tandai selesai: ${s.title}`}
        onClick={() => run(() => toggleSubtask(s.id, taskId, !s.is_completed), { silent: true })}>
        {s.is_completed && <Check size={14} strokeWidth={3} aria-hidden="true" />}
      </button>
      <span className="item-title flex-1 min-w-0">{s.title}</span>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Hapus subtugas ${s.title}`} disabled={pending}
        onClick={() => run(() => deleteSubtask(s.id, taskId), { silent: true })}><Trash2 size={15} /></button>
    </li>
  )
}
