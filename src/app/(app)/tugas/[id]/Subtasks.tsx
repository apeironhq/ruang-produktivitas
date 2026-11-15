'use client'

import { Check, ListChecks, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useRunAction } from '@/components/ui/actions'
import { Field, FormModal, errClass } from '@/components/ui/forms'
import type { Subtask } from '@/lib/types'
import { addSubtask, deleteSubtask, toggleSubtask } from '../actions'

/** Tombol "Tambah subtugas" di kepala kartu → popup (boleh banyak baris sekaligus). */
export function AddSubtaskButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Plus size={15} />Subtugas</button>
      {open && (
        <FormModal open={open} onClose={() => setOpen(false)} action={addSubtask} icon={<ListChecks size={18} />}
          title="Tambah subtugas" subtitle="Pecah tugas menjadi langkah kecil." submitLabel="Tambah">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="task_id" value={taskId} />
              <Field label="Subtugas" name="titles" error={errors.titles} hint="Satu subtugas per baris.">
                <textarea id="titles" name="titles" rows={5} className={`textarea${errClass(errors, 'titles')}`} required
                  placeholder={'Baca dokumentasi\nPraktik middleware\nTulis ringkasan'} />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

export function Subtasks({ taskId, items }: { taskId: string; items: Subtask[] }) {
  return <ul className="items">{items.map((s) => <SubtaskRow key={s.id} s={s} taskId={taskId} />)}</ul>
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
