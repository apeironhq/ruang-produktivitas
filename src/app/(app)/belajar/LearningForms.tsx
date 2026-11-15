'use client'

import { ArrowDown, ArrowUp, BookOpen, Check, Clock, Library, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useRunAction } from '@/components/ui/actions'
import { Field, FormModal, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { SOURCE_TYPE } from '@/lib/labels'
import type { Module, Option, Source } from '@/lib/types'
import { addModules, deleteModule, logSession, moveModule, saveSource, saveSubject, setModuleApplicable, setModuleDone } from './actions'

// ---------- Bidang ----------
export interface SubjectValues { id?: string; title: string; description: string; goal_id: string | null; status: string }

export function SubjectFormModal({ open, onClose, initial, goals }: { open: boolean; onClose: () => void; initial: SubjectValues; goals: Option[] }) {
  const editing = !!initial.id
  return (
    <FormModal open={open} onClose={onClose} action={saveSubject} icon={<BookOpen size={18} />}
      title={editing ? 'Ubah bidang belajar' : 'Bidang belajar baru'} subtitle="Mis. Next.js, Bahasa Inggris, Analisis trading."
      submitLabel={editing ? 'Simpan perubahan' : 'Buat bidang'} redirectTo={editing ? undefined : (id) => `/belajar/${id}`}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <Field label="Nama bidang" name="title" error={errors.title}>
            <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial.title} maxLength={120} required />
          </Field>
          <Field label="Tujuan / deskripsi" name="description">
            <textarea id="description" name="description" className="textarea" rows={2} defaultValue={initial.description} maxLength={2000} placeholder="Apa yang ingin dikuasai?" />
          </Field>
          <div className="form-grid form-grid-2">
            <Field label="Target terkait" name="goal_id" hint="Target bersumber 'Modul belajar' menghitung progres dari bidang ini.">
              <select id="goal_id" name="goal_id" className="select" defaultValue={initial.goal_id ?? ''}>
                <option value="">— Tidak ada —</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </Field>
            {editing && (
              <Field label="Status" name="status">
                <select id="status" name="status" className="select" defaultValue={initial.status}>
                  <option value="aktif">Aktif</option><option value="selesai">Selesai</option><option value="arsip">Diarsipkan</option>
                </select>
              </Field>
            )}
          </div>
          {!editing && (
            <Field label="Daftar modul / materi" name="modules" hint="Satu modul per baris. Progres = modul selesai ÷ total modul.">
              <textarea id="modules" name="modules" className="textarea" rows={5} placeholder={'Pengenalan App Router\nRouting & layout\nAutentikasi Supabase'} />
            </Field>
          )}
        </div>
      )}
    </FormModal>
  )
}

export function NewSubjectButton({ goals, className = 'btn btn-primary', label = 'Bidang baru' }: { goals: Option[]; className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><Plus size={16} />{label}</button>
      {open && <SubjectFormModal open={open} onClose={() => setOpen(false)} initial={{ title: '', description: '', goal_id: null, status: 'aktif' }} goals={goals} />}
    </>
  )
}

export function EditSubjectButton({ initial, goals }: { initial: SubjectValues; goals: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Ubah</button>
      {open && <SubjectFormModal open={open} onClose={() => setOpen(false)} initial={initial} goals={goals} />}
    </>
  )
}

// ---------- Sesi ----------
export interface SubjectBundle { id: string; title: string; sources: Pick<Source, 'id' | 'title' | 'position'>[]; modules: Pick<Module, 'id' | 'title' | 'completed_at'>[] }

export function SessionButton({ subjects, defaultSubjectId, today, className = 'btn btn-primary', label = 'Catat sesi' }: {
  subjects: SubjectBundle[]; defaultSubjectId?: string; today: string; className?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  const [subjectId, setSubjectId] = useState(defaultSubjectId ?? subjects[0]?.id ?? '')
  const [sourceId, setSourceId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const subject = useMemo(() => subjects.find((s) => s.id === subjectId), [subjects, subjectId])
  const source = subject?.sources.find((s) => s.id === sourceId)
  const openModules = subject?.modules.filter((m) => !m.completed_at) ?? []
  const disabled = subjects.length === 0
  return (
    <>
      <button type="button" className={className} disabled={disabled} title={disabled ? 'Buat bidang belajar terlebih dahulu' : undefined}
        onClick={() => { setSourceId(''); setModuleId(''); setOpen(true) }}><Clock size={16} />{label}</button>
      {open && (
        <FormModal open={open} onClose={() => setOpen(false)} action={logSession} size="lg" icon={<Clock size={18} />}
          title="Catat sesi belajar" subtitle="Durasi, posisi terakhir, ringkasan, kendala, dan langkah berikutnya." submitLabel="Simpan sesi">
          {(errors) => (
            <div className="form-stack">
              <div className="form-grid form-grid-2">
                <Field label="Bidang belajar" name="subject_id" error={errors.subject_id}>
                  <select id="subject_id" name="subject_id" className="select" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSourceId(''); setModuleId('') }}>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </Field>
                <Field label="Tanggal" name="session_date" error={errors.session_date}>
                  <input id="session_date" name="session_date" type="date" className="input" defaultValue={today} required />
                </Field>
                <Field label="Sumber" name="source_id" hint={source?.position ? `Posisi terakhir: ${source.position}` : 'Opsional'}>
                  <select id="source_id" name="source_id" className="select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    <option value="">— Tanpa sumber —</option>
                    {subject?.sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </Field>
                <Field label="Modul" name="module_id" hint="Opsional">
                  <select id="module_id" name="module_id" className="select" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                    <option value="">— Tanpa modul —</option>
                    {openModules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </Field>
                <Field label="Durasi (menit)" name="duration_minutes" error={errors.duration_minutes}>
                  <input id="duration_minutes" name="duration_minutes" inputMode="numeric" className={`input${errClass(errors, 'duration_minutes')}`} defaultValue="60" required />
                </Field>
                <Field label="Posisi terakhir" name="position" hint={sourceId ? 'Disimpan juga ke sumber' : 'Bab, halaman, menit video, modul'}>
                  <input id="position" name="position" className="input" maxLength={120} placeholder="Mis. Modul 7 dari 10" defaultValue={source?.position ?? ''} key={sourceId} />
                </Field>
              </div>
              {moduleId && (
                <label className="flex items-center gap-2 text-label"><input type="checkbox" name="complete_module" className="checkbox" />Tandai modul ini selesai</label>
              )}
              <Field label="Materi" name="material">
                <input id="material" name="material" className="input" maxLength={200} placeholder="Mis. Autentikasi menggunakan Supabase" />
              </Field>
              <Field label="Ringkasan" name="summary">
                <textarea id="summary" name="summary" className="textarea" rows={3} maxLength={4000} placeholder="Apa yang sudah dipahami?" />
              </Field>
              <div className="form-grid form-grid-2">
                <Field label="Kendala" name="obstacles">
                  <textarea id="obstacles" name="obstacles" className="textarea" rows={2} maxLength={2000} />
                </Field>
                <Field label="Langkah berikutnya" name="next_steps">
                  <textarea id="next_steps" name="next_steps" className="textarea" rows={2} maxLength={2000} />
                </Field>
              </div>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

// ---------- Sumber ----------
export function SourceButton({ subjectId, initial, label }: { subjectId: string; initial?: Source; label?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {initial
        ? <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Ubah sumber ${initial.title}`} onClick={() => setOpen(true)}><MoreHorizontal size={16} /></button>
        : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>{label ?? <><Plus size={15} />Sumber</>}</button>}
      {open && (
        <FormModal open={open} onClose={() => setOpen(false)} action={saveSource} icon={<Library size={18} />}
          title={initial ? 'Ubah sumber' : 'Tambah sumber belajar'} submitLabel={initial ? 'Simpan' : 'Tambah'}>
          {(errors) => (
            <div className="form-stack">
              {initial && <input type="hidden" name="id" value={initial.id} />}
              <input type="hidden" name="subject_id" value={subjectId} />
              <Field label="Judul" name="title" error={errors.title}>
                <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial?.title} maxLength={200} required placeholder="Mis. Dokumentasi resmi Next.js" />
              </Field>
              <div className="form-grid form-grid-2">
                <Field label="Jenis" name="source_type">
                  <select id="source_type" name="source_type" className="select" defaultValue={initial?.source_type ?? 'tautan'}>
                    {Object.entries(SOURCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Posisi terakhir" name="position" hint="Bab, halaman, menit, modul">
                  <input id="position" name="position" className="input" defaultValue={initial?.position} maxLength={120} />
                </Field>
              </div>
              <Field label="Tautan" name="url" error={errors.url} hint="Opsional">
                <input id="url" name="url" type="url" className={`input${errClass(errors, 'url')}`} defaultValue={initial?.url} maxLength={2000} placeholder="https://" />
              </Field>
              <Field label="Catatan" name="notes">
                <textarea id="notes" name="notes" className="textarea" rows={2} defaultValue={initial?.notes} maxLength={2000} />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

// ---------- Modul ----------
export function ModuleList({ subjectId, modules }: { subjectId: string; modules: Module[] }) {
  const form = useRef<HTMLFormElement | null>(null)
  const { formAction, errors } = useFormAction(addModules, { onSuccess: () => form.current?.reset() })
  return (
    <div>
      {modules.length > 0 && (
        <ol className="items mb-4">
          {modules.map((m, i) => <ModuleRow key={m.id} m={m} subjectId={subjectId} index={i} last={i === modules.length - 1} />)}
        </ol>
      )}
      <form ref={form} action={formAction} className="flex gap-2 items-start" noValidate>
        <input type="hidden" name="subject_id" value={subjectId} />
        <div className="flex-1 min-w-0">
          <label htmlFor="titles" className="sr-only">Modul baru</label>
          <textarea id="titles" name="titles" rows={1} className={`textarea${errors.titles ? ' has-error' : ''}`} style={{ minHeight: 40, paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
            placeholder="Tambah modul… (tempel banyak baris sekaligus)" required />
          {errors.titles && <p className="field-error mt-1">{errors.titles}</p>}
        </div>
        <SubmitButton variant="secondary" loadingText="…"><Plus size={16} /><span className="hidden sm:inline">Tambah</span></SubmitButton>
      </form>
    </div>
  )
}

function ModuleRow({ m, subjectId, index, last }: { m: Module; subjectId: string; index: number; last: boolean }) {
  const { pending, run } = useRunAction()
  const done = !!m.completed_at
  return (
    <li className={`item${done ? ' is-done' : ''}`} style={{ opacity: m.is_applicable ? 1 : 0.55 }}>
      <button type="button" className={`task-check${done ? ' done' : ''}`} disabled={pending || !m.is_applicable} aria-pressed={done}
        aria-label={done ? `Buka lagi: ${m.title}` : `Tandai selesai: ${m.title}`}
        onClick={() => run(() => setModuleDone(m.id, subjectId, !done), { silent: true })}>
        {done && <Check size={14} strokeWidth={3} aria-hidden="true" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="item-title block">{index + 1}. {m.title}</span>
        {!m.is_applicable && <span className="item-sub">Dilewati — tidak dihitung dalam progres</span>}
      </span>
      <span className="flex items-center gap-0.5 shrink-0">
        <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={pending || index === 0} aria-label="Naikkan" onClick={() => run(() => moveModule(m.id, subjectId, -1), { silent: true })}><ArrowUp size={15} /></button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={pending || last} aria-label="Turunkan" onClick={() => run(() => moveModule(m.id, subjectId, 1), { silent: true })}><ArrowDown size={15} /></button>
        <button type="button" className="btn btn-ghost btn-sm hidden sm:inline-flex" disabled={pending} onClick={() => run(() => setModuleApplicable(m.id, subjectId, !m.is_applicable))}>
          {m.is_applicable ? 'Lewati' : 'Hitung'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={pending} aria-label={`Hapus modul ${m.title}`} onClick={() => run(() => deleteModule(m.id, subjectId))}><Trash2 size={15} /></button>
      </span>
    </li>
  )
}
