'use client'

import { CalendarClock, Check, CheckSquare, MapPin, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useOptimisticToggle, useRunAction } from '@/components/ui/actions'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Choices, Field, FormModal, errClass } from '@/components/ui/forms'
import { EVENT_STATUS, PRIORITY, RECURRENCE, REMIND_OPTIONS, TASK_STATUS, TASK_STATUS_ORDER } from '@/lib/labels'
import type { LinkOptions } from '@/lib/queries'
import { saveTask, setTaskStatus } from './actions'

export interface TaskFormValues {
  id?: string
  kind: 'tugas' | 'kegiatan'
  title: string
  description: string
  category: string
  priority: string
  status: string
  due_local: string
  start_local: string
  end_local: string
  location: string
  goal_id: string | null
  project_id: string | null
  subject_id: string | null
  recurrence: string
  /** menit sebelum waktu; '' = tanpa pengingat */
  remind: string
}

const ADV_FIELDS = ['recurrence', 'remind', 'category', 'goal_id', 'subject_id', 'project_id', 'description']

export const emptyTask = (kind: 'tugas' | 'kegiatan' = 'tugas', preset: Partial<TaskFormValues> = {}): TaskFormValues => ({
  kind, title: '', description: '', category: '', priority: 'sedang', status: 'belum',
  due_local: '', start_local: '', end_local: '', location: '', goal_id: null, project_id: null, subject_id: null,
  recurrence: 'tidak', remind: '', ...preset,
})

export function LinkSelects({ options, values, errors }: { options: LinkOptions; values: { goal_id?: string | null; subject_id?: string | null; project_id?: string | null }; errors: Record<string, string> }) {
  return (
    <>
      <Field label="Target terkait" name="goal_id" error={errors.goal_id}>
        <select id="goal_id" name="goal_id" className="select" defaultValue={values.goal_id ?? ''}>
          <option value="">— Tidak ada —</option>
          {options.goals.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
      <Field label="Bidang belajar" name="subject_id" error={errors.subject_id}>
        <select id="subject_id" name="subject_id" className="select" defaultValue={values.subject_id ?? ''}>
          <option value="">— Tidak ada —</option>
          {options.subjects.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
      {options.projects.length > 0 && (
        <Field label="Proyek" name="project_id" error={errors.project_id}>
          <select id="project_id" name="project_id" className="select" defaultValue={values.project_id ?? ''}>
            <option value="">— Tidak ada —</option>
            {options.projects.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
      )}
    </>
  )
}

export function TaskFormModal({ open, onClose, initial, options }: {
  open: boolean; onClose: () => void; initial: TaskFormValues; options: LinkOptions
}) {
  const [kind, setKind] = useState(initial.kind)
  const editing = !!initial.id
  const noun = kind === 'kegiatan' ? 'kegiatan' : 'tugas'
    const hasAdvanced = initial.recurrence !== 'tidak' || initial.remind !== '' || !!initial.category || !!initial.goal_id || !!initial.subject_id || !!initial.project_id || !!initial.description
  return (
    <FormModal open={open} onClose={onClose} action={saveTask} size="lg" icon={kind === 'kegiatan' ? <CalendarClock size={18} /> : <CheckSquare size={18} />}
      title={editing ? `Ubah ${noun}` : `Tambah ${noun}`}
      subtitle={kind === 'kegiatan' ? 'Kegiatan punya jadwal (jam mulai–selesai), tanpa alur status.' : 'Tugas punya tenggat, prioritas, status, dan daftar periksa.'}
      submitLabel={editing ? 'Simpan perubahan' : `Tambah ${noun}`}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          {editing ? <input type="hidden" name="kind" value={kind} /> : (
            <Choices name="kind" label="Jenis" value={kind} onChange={(v) => setKind(v as 'tugas' | 'kegiatan')} options={[
              { value: 'tugas', title: 'Tugas', desc: 'Punya tenggat, prioritas, status, dan subtugas' },
              { value: 'kegiatan', title: 'Kegiatan', desc: 'Punya jadwal jam mulai–selesai dan lokasi' },
            ]} />
          )}
          <Field label="Judul" name="title" error={errors.title}>
            <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial.title} required maxLength={200}
              placeholder={kind === 'kegiatan' ? 'Mis. Kajian rutin' : 'Mis. Selesaikan modul 7 Next.js'} />
          </Field>
          <div className="form-grid form-grid-2">
            {kind === 'tugas' ? (
              <>
                <Field label="Tenggat" name="due_at" error={errors.due_at} hint="Opsional">
                  <DateTimePicker id="due_at" name="due_at" defaultValue={initial.due_local} defaultTime="17:00" invalid={!!errors.due_at} />
                </Field>
                <Field label="Mulai dikerjakan" name="start_at" error={errors.start_at} hint="Opsional — tampil di kalender">
                  <DateTimePicker id="start_at" name="start_at" defaultValue={initial.start_local} invalid={!!errors.start_at} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Mulai" name="start_at" error={errors.start_at}>
                  <DateTimePicker id="start_at" name="start_at" defaultValue={initial.start_local} invalid={!!errors.start_at} required />
                </Field>
                <Field label="Selesai" name="end_at" error={errors.end_at} hint="Opsional">
                  <DateTimePicker id="end_at" name="end_at" defaultValue={initial.end_local} defaultTime="10:00" invalid={!!errors.end_at} />
                </Field>
                <Field label="Lokasi" name="location" error={errors.location} className="col-span-full">
                  <div className="relative">
                    <MapPin size={16} className="search-icon" aria-hidden="true" />
                    <input id="location" name="location" className="input pl-9" defaultValue={initial.location} maxLength={200} placeholder="Opsional" />
                  </div>
                </Field>
              </>
            )}
            <Field label="Prioritas" name="priority" error={errors.priority}>
              <select id="priority" name="priority" className="select" defaultValue={initial.priority}>
                {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Status" name="status" error={errors.status}>
              <select id="status" name="status" className="select" defaultValue={initial.status}>
                {TASK_STATUS_ORDER.filter((s) => kind === 'tugas' || s !== 'dikerjakan').map((s) => <option key={s} value={s}>{(kind === 'kegiatan' ? EVENT_STATUS : TASK_STATUS)[s]!.label}</option>)}
              </select>
            </Field>
          </div>
          {/* Isian tambahan dilipat agar form tidak panjang; terbuka otomatis bila sudah berisi atau ada galat. */}
          <details className="form-more" open={hasAdvanced || ADV_FIELDS.some((k) => errors[k]) || undefined}>
            <summary>Opsi lainnya<span>Ulangi, pengingat, kategori, tautan, deskripsi{!editing && kind === 'tugas' ? ', daftar periksa' : ''}</span></summary>
            <div className="form-stack">
          <div className="form-grid form-grid-2">
            <Field label="Ulangi" name="recurrence" error={errors.recurrence} hint="Saat selesai, jadwal berikutnya dibuat otomatis">
              <select id="recurrence" name="recurrence" className={`select${errClass(errors, 'recurrence')}`} defaultValue={initial.recurrence}>
                {Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Ingatkan" name="remind" error={errors.remind} hint="Lewat Telegram & ringkasan harian">
              <select id="remind" name="remind" className={`select${errClass(errors, 'remind')}`} defaultValue={initial.remind}>
                <option value="">Tanpa pengingat</option>
                {REMIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {initial.remind !== '' && !REMIND_OPTIONS.some((o) => String(o.value) === initial.remind) && <option value={initial.remind}>{initial.remind} menit sebelumnya</option>}
              </select>
            </Field>
            <Field label="Kategori" name="category" error={errors.category} hint="Mis. Kuliah, Kantor, Rumah">
              <input id="category" name="category" className="input" defaultValue={initial.category} maxLength={60} />
            </Field>
            <LinkSelects options={options} values={initial} errors={errors} />
          </div>
          <Field label="Deskripsi" name="description" error={errors.description}>
            <textarea id="description" name="description" className="textarea" defaultValue={initial.description} maxLength={4000} rows={3} />
          </Field>
          {!editing && kind === 'tugas' && (
            <Field label="Daftar periksa" name="checklist" hint="Satu subtugas per baris. Bisa ditambah nanti.">
              <textarea id="checklist" name="checklist" className="textarea" rows={3} placeholder={'Baca dokumentasi\nPraktik middleware\nTulis ringkasan'} />
            </Field>
          )}
            </div>
          </details>
        </div>
      )}
    </FormModal>
  )
}

/** Lingkaran centang untuk menandai tugas selesai / membuka lagi. */
export function TaskCheck({ id, done, title }: { id: string; done: boolean; title: string }) {
  const { checked, pending, toggle } = useOptimisticToggle(done)
  return (
    <button type="button" className={`task-check${checked ? ' done' : ''}`} disabled={pending} aria-busy={pending}
      aria-label={checked ? `Buka lagi: ${title}` : `Tandai selesai: ${title}`} aria-pressed={checked}
      onClick={() => toggle((next) => setTaskStatus(id, next ? 'selesai' : 'belum'))}>
      {checked && <Check size={14} strokeWidth={3} aria-hidden="true" />}
    </button>
  )
}

export function StatusSelect({ id, status, compact }: { id: string; status: string; compact?: boolean }) {
  const { pending, run } = useRunAction()
  return (
    <select className={`select${compact ? ' h-[34px] text-[0.8125rem]' : ''}`} aria-label="Ubah status" value={status} disabled={pending}
      onChange={(e) => run(() => setTaskStatus(id, e.target.value))}>
      {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS[s]!.label}</option>)}
    </select>
  )
}

export function NewTaskButton({ options, preset, label = 'Tambah tugas', className = 'btn btn-primary', autoOpen = false }: {
  options: LinkOptions; preset?: Partial<TaskFormValues>; label?: string; className?: string; autoOpen?: boolean
}) {
  const [open, setOpen] = useState(autoOpen)
  const [key, setKey] = useState(0)
  return (
    <>
      <button type="button" className={className} onClick={() => { setKey((k) => k + 1); setOpen(true) }}><Plus size={16} />{label}</button>
      {open && <TaskFormModal key={key} open={open} onClose={() => setOpen(false)} initial={emptyTask(preset?.kind ?? 'tugas', preset)} options={options} />}
    </>
  )
}

export function EditTaskButton({ initial, options }: { initial: TaskFormValues; options: LinkOptions }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}><Pencil size={16} />Ubah</button>
      {open && <TaskFormModal open={open} onClose={() => setOpen(false)} initial={initial} options={options} />}
    </>
  )
}
