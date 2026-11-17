'use client'

import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { NotebookPen, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Field, FormModal, errClass } from '@/components/ui/forms'
import { JOURNAL_KIND, MOOD } from '@/lib/labels'
import type { JournalEntry, Option } from '@/lib/types'
import { saveEntry } from './actions'

export interface JournalValues {
  id?: string
  kind: JournalEntry['kind']
  title: string
  content: string
  entry_date: string
  tags: string
  mood: number | null
  goal_id: string | null
  subject_id: string | null
  project_id?: string | null
  trading: JournalEntry['trading']
}

export const emptyJournal = (today: string, preset: Partial<JournalValues> = {}): JournalValues => ({
  kind: 'catatan', title: '', content: '', entry_date: today, tags: '', mood: null, goal_id: null, subject_id: null, project_id: null, trading: null, ...preset,
})

/** Popup tulis/ubah catatan — satu formulir untuk semua jenis (jurnal trading menampilkan kolom tambahan). */
export function JournalFormModal({ open, onClose, initial, goals, subjects, projects = [] }: {
  open: boolean; onClose: () => void; initial: JournalValues; goals: Option[]; subjects: Option[]; projects?: Option[]
}) {
  const [kind, setKind] = useState(initial.kind)
  const editing = !!initial.id
  const t = initial.trading ?? {}
  return (
    <FormModal open={open} onClose={onClose} action={saveEntry} size="lg" icon={<NotebookPen size={18} />}
      title={editing ? 'Ubah catatan' : 'Catatan baru'} subtitle={JOURNAL_KIND[kind]?.desc}
      submitLabel={editing ? 'Simpan perubahan' : 'Simpan catatan'}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="form-grid form-grid-2">
            <Field label="Jenis" name="kind">
              <select id="kind" name="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as JournalValues['kind'])}>
                {Object.entries(JOURNAL_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Tanggal" name="entry_date" error={errors.entry_date}>
              <DateTimePicker id="entry_date" name="entry_date" mode="date" quick="past" defaultValue={initial.entry_date} invalid={!!errors.entry_date} required />
            </Field>
          </div>
          <Field label="Judul" name="title" error={errors.title}>
            <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial.title} maxLength={200} placeholder="Judul catatan" />
          </Field>
          <Field label="Isi" name="content" error={errors.content}>
            <textarea id="content" name="content" className="textarea" rows={9} defaultValue={initial.content} maxLength={50000}
              placeholder={kind === 'harian' ? 'Bagaimana hari ini? Apa yang disyukuri, dipelajari, dan direncanakan besok?' : 'Tulis di sini…'} />
          </Field>

          {kind === 'trading' && (
            <div className="form-section">
              <p className="form-section-title">Detail trading</p>
              <p className="text-caption mb-4">Catatan analisis saja — tidak dihitung sebagai pemasukan atau pengeluaran.</p>
              <div className="form-grid form-grid-2">
                <Field label="Instrumen" name="t_instrument"><input id="t_instrument" name="t_instrument" className="input" defaultValue={t.instrument} maxLength={60} placeholder="Mis. BBCA, XAUUSD" /></Field>
                <Field label="Posisi" name="t_side">
                  <select id="t_side" name="t_side" className="select" defaultValue={t.side ?? ''}><option value="">—</option><option value="beli">Beli / long</option><option value="jual">Jual / short</option></select>
                </Field>
                <Field label="Strategi" name="t_strategy" className="col-span-full"><input id="t_strategy" name="t_strategy" className="input" defaultValue={t.strategy} maxLength={120} placeholder="Mis. Breakout, support-resistance" /></Field>
                <Field label="Harga masuk" name="t_entry" error={errors.t_entry}><input id="t_entry" name="t_entry" inputMode="decimal" className="input" defaultValue={t.entry_price ?? ''} /></Field>
                <Field label="Harga keluar" name="t_exit" error={errors.t_exit}><input id="t_exit" name="t_exit" inputMode="decimal" className="input" defaultValue={t.exit_price ?? ''} /></Field>
                <Field label="Biaya" name="t_fee" error={errors.t_fee}><input id="t_fee" name="t_fee" inputMode="decimal" className="input" defaultValue={t.fee ?? ''} /></Field>
                <Field label="Hasil (laba/rugi)" name="t_result" error={errors.t_result} hint="Negatif bila rugi, mis. -150.000"><input id="t_result" name="t_result" inputMode="decimal" className="input" defaultValue={t.result ?? ''} /></Field>
                <Field label="Evaluasi" name="t_evaluation" className="col-span-full"><textarea id="t_evaluation" name="t_evaluation" className="textarea" rows={3} defaultValue={t.evaluation} maxLength={4000} placeholder="Apa yang berjalan baik? Apa yang perlu diperbaiki?" /></Field>
              </div>
            </div>
          )}

          <div className="form-section form-grid form-grid-2">
            {kind === 'harian' && (
              <Field label="Suasana hati" name="mood">
                <select id="mood" name="mood" className="select" defaultValue={initial.mood ?? ''}>
                  <option value="">—</option>
                  {Object.entries(MOOD).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tag" name="tags" hint="Pisahkan dengan koma, mis. nextjs, ide-bisnis" className={kind === 'harian' ? '' : 'col-span-full'}>
              <input id="tags" name="tags" className="input" defaultValue={initial.tags} maxLength={400} />
            </Field>
            <Field label="Target terkait" name="goal_id">
              <select id="goal_id" name="goal_id" className="select" defaultValue={initial.goal_id ?? ''}>
                <option value="">— Tidak ada —</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </Field>
            <Field label="Bidang belajar" name="subject_id">
              <select id="subject_id" name="subject_id" className="select" defaultValue={initial.subject_id ?? ''}>
                <option value="">— Tidak ada —</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </Field>
            {projects.length > 0 ? (
              <Field label="Proyek" name="project_id" className="col-span-full">
                <select id="project_id" name="project_id" className="select" defaultValue={initial.project_id ?? ''}>
                  <option value="">— Tidak ada —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
            ) : initial.project_id ? <input type="hidden" name="project_id" value={initial.project_id} /> : null}
          </div>
        </div>
      )}
    </FormModal>
  )
}

export function NewJournalButton({ today, goals, subjects, projects, preset, label = 'Catatan baru', className = 'btn btn-primary', autoOpen = false }: {
  today: string; goals: Option[]; subjects: Option[]; projects?: Option[]; preset?: Partial<JournalValues>; label?: string; className?: string; autoOpen?: boolean
}) {
  const [open, setOpen] = useState(autoOpen)
  const [key, setKey] = useState(0)
  return (
    <>
      <button type="button" className={className} onClick={() => { setKey((k) => k + 1); setOpen(true) }}><Plus size={16} />{label}</button>
      {open && <JournalFormModal key={key} open={open} onClose={() => setOpen(false)} initial={emptyJournal(today, preset)} goals={goals} subjects={subjects} projects={projects} />}
    </>
  )
}

export function EditJournalButton({ initial, goals, subjects, projects }: { initial: JournalValues; goals: Option[]; subjects: Option[]; projects?: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}><Pencil size={16} />Ubah</button>
      {open && <JournalFormModal open={open} onClose={() => setOpen(false)} initial={initial} goals={goals} subjects={subjects} projects={projects} />}
    </>
  )
}
