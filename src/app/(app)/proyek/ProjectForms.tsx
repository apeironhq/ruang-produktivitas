'use client'

import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Check, FolderKanban, Milestone, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useOptimisticToggle, useRunAction } from '@/components/ui/actions'
import { Choices, Field, FormModal, errClass } from '@/components/ui/forms'
import { PROJECT_STATUS } from '@/lib/labels'
import type { Option, ProjectMilestone } from '@/lib/types'
import { addProjectMilestones, deleteProjectMilestone, saveProject, setProjectMilestoneDone } from './actions'

export interface ProjectValues {
  id?: string
  title: string
  description: string
  status: string
  goal_id: string | null
  start_date: string
  due_date: string
}

export const emptyProject = (today: string): ProjectValues => ({ title: '', description: '', status: 'aktif', goal_id: null, start_date: today, due_date: '' })

export function ProjectFormModal({ open, onClose, initial, goals }: { open: boolean; onClose: () => void; initial: ProjectValues; goals: Option[] }) {
  const editing = !!initial.id
  return (
    <FormModal open={open} onClose={onClose} action={saveProject} size="lg" icon={<FolderKanban size={18} />}
      title={editing ? 'Ubah proyek' : 'Proyek baru'} subtitle="Kelompokkan tugas, tahapan, dan catatan dalam satu proyek."
      submitLabel={editing ? 'Simpan perubahan' : 'Buat proyek'} redirectTo={editing ? undefined : (id) => `/proyek/${id}`}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <Field label="Nama proyek" name="title" error={errors.title}>
            <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial.title} maxLength={160} required placeholder="Mis. Aplikasi Ruang Produktivitas v1" />
          </Field>
          <Choices name="status" label="Status" defaultValue={initial.status} columns={editing ? 3 : 2}
            options={Object.entries(PROJECT_STATUS).filter(([k]) => editing || k === 'rencana' || k === 'aktif').map(([k, v]) => ({ value: k, title: v.label, desc: v.desc }))} />
          <div className="form-grid form-grid-2">
            <Field label="Tanggal mulai" name="start_date" error={errors.start_date} hint="Opsional">
              <DateTimePicker id="start_date" name="start_date" mode="date" defaultValue={initial.start_date} invalid={!!errors.start_date} />
            </Field>
            <Field label="Tenggat" name="due_date" error={errors.due_date} hint="Opsional">
              <DateTimePicker id="due_date" name="due_date" mode="date" defaultValue={initial.due_date} invalid={!!errors.due_date} />
            </Field>
            <Field label="Target terkait" name="goal_id" className="col-span-full">
              <select id="goal_id" name="goal_id" className="select" defaultValue={initial.goal_id ?? ''}>
                <option value="">— Tidak ada —</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Deskripsi" name="description">
            <textarea id="description" name="description" className="textarea" rows={3} defaultValue={initial.description} maxLength={4000} placeholder="Tujuan dan ruang lingkup proyek" />
          </Field>
          {!editing && (
            <Field label="Tahapan (opsional)" name="milestones" hint="Satu tahapan per baris. Progres dihitung dari tugas proyek, atau dari tahapan bila belum ada tugas.">
              <textarea id="milestones" name="milestones" className="textarea" rows={4} placeholder={'Riset & desain\nPengembangan\nUji coba\nRilis'} />
            </Field>
          )}
        </div>
      )}
    </FormModal>
  )
}

export function NewProjectButton({ today, goals, label = 'Proyek baru', className = 'btn btn-primary' }: { today: string; goals: Option[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <>
      <button type="button" className={className} onClick={() => { setKey((k) => k + 1); setOpen(true) }}><Plus size={16} />{label}</button>
      {open && <ProjectFormModal key={key} open onClose={() => setOpen(false)} initial={emptyProject(today)} goals={goals} />}
    </>
  )
}

export function EditProjectButton({ initial, goals }: { initial: ProjectValues; goals: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}><Pencil size={16} />Ubah</button>
      {open && <ProjectFormModal open onClose={() => setOpen(false)} initial={initial} goals={goals} />}
    </>
  )
}

export function AddProjectMilestonesButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Plus size={15} />Tahapan</button>
      {open && (
        <FormModal open onClose={() => setOpen(false)} action={addProjectMilestones} icon={<Milestone size={18} />} title="Tambah tahapan" submitLabel="Tambah">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="project_id" value={projectId} />
              <Field label="Tahapan" name="titles" error={errors.titles} hint="Satu tahapan per baris — bisa banyak sekaligus.">
                <textarea id="titles" name="titles" rows={4} className={`textarea${errClass(errors, 'titles')}`} required placeholder={'Uji coba pengguna\nRilis publik'} />
              </Field>
              <Field label="Tenggat" name="due_date" hint="Opsional, hanya dipakai bila menambah satu tahapan">
                <DateTimePicker id="due_date" name="due_date" mode="date" />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

export function ProjectMilestoneRow({ m, projectId, dueLabel }: { m: ProjectMilestone; projectId: string; dueLabel: string | null }) {
  const check = useOptimisticToggle(!!m.completed_at)
  const { pending, run } = useRunAction()
  return (
    <li className={`item${check.checked ? ' is-done' : ''}`}>
      <button type="button" className={`task-check${check.checked ? ' done' : ''}`} disabled={check.pending} aria-busy={check.pending} aria-pressed={check.checked}
        aria-label={check.checked ? `Buka lagi: ${m.title}` : `Tandai selesai: ${m.title}`}
        onClick={() => check.toggle((next) => setProjectMilestoneDone(m.id, projectId, next))}>
        {check.checked && <Check size={14} strokeWidth={3} aria-hidden="true" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="item-title block">{m.title}</span>
        {dueLabel && <span className="item-sub">Tenggat {dueLabel}</span>}
      </span>
      <button type="button" className="btn btn-ghost btn-sm btn-icon is-danger" disabled={pending} aria-label={`Hapus tahapan ${m.title}`}
        onClick={() => run(() => deleteProjectMilestone(m.id, projectId))}><Trash2 size={15} /></button>
    </li>
  )
}
