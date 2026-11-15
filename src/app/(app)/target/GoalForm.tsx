'use client'

import { Flag, Plus, Target } from 'lucide-react'
import { useState } from 'react'
import { Choices, Field, FormModal, errClass } from '@/components/ui/forms'
import { METRIC, PROGRESS_SOURCE } from '@/lib/labels'
import { addContribution, addMilestone, saveGoal } from './actions'

export interface GoalFormValues {
  id?: string
  title: string
  description: string
  category: string
  metric_type: string
  unit_label: string
  direction: string
  progress_source: string
  start_value: string
  target_value: string
  priority: string
  start_date: string
  due_date: string
}

export const blankGoal = (today: string): GoalFormValues => ({
  title: '', description: '', category: '', metric_type: 'rupiah', unit_label: '', direction: 'naik', progress_source: 'manual',
  start_value: '0', target_value: '', priority: 'sedang', start_date: today, due_date: '',
})

export function GoalFormModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: GoalFormValues }) {
  const [source, setSource] = useState(initial.progress_source)
  const [metric, setMetric] = useState(initial.metric_type)
  const [direction, setDirection] = useState(initial.direction)
  const editing = !!initial.id
  const manual = source === 'manual'
  const binary = metric === 'biner'
  return (
    <FormModal open={open} onClose={onClose} action={saveGoal} size="lg" icon={<Target size={18} />}
      title={editing ? 'Ubah target' : 'Buat target'} subtitle="Progres dihitung dari satu sumber agar tidak tercatat ganda."
      submitLabel={editing ? 'Simpan perubahan' : 'Buat target'} redirectTo={editing ? undefined : (id) => `/target/${id}`}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <Field label="Nama target" name="title" error={errors.title}>
            <input id="title" name="title" className={`input${errClass(errors, 'title')}`} defaultValue={initial.title} maxLength={160} required placeholder="Mis. Tabungan Rp100.000.000" />
          </Field>
          <Choices name="progress_source" label="Sumber progres" value={source} onChange={setSource} error={errors.progress_source} columns={3}
            options={Object.entries(PROGRESS_SOURCE).map(([k, v]) => ({ value: k, title: v.label, desc: v.hint }))} />
          {!manual && <input type="hidden" name="metric_type" value="jumlah" />}
          {manual && (
            <div className="form-grid form-grid-2">
              <Field label="Satuan" name="metric_type" error={errors.metric_type} hint={METRIC[metric]?.hint}>
                <select id="metric_type" name="metric_type" className="select" value={metric} onChange={(e) => setMetric(e.target.value)}>
                  {Object.entries(METRIC).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              {metric === 'jumlah' ? (
                <Field label="Nama satuan" name="unit_label" hint="Mis. buku, km, kg">
                  <input id="unit_label" name="unit_label" className="input" defaultValue={initial.unit_label} maxLength={30} />
                </Field>
              ) : <input type="hidden" name="unit_label" value="" />}
              {!binary && (
                <>
                  <Field label="Arah" name="direction" error={errors.direction} hint={direction === 'turun' ? 'Mis. melunasi utang, menurunkan berat badan' : 'Mis. menabung, menambah bacaan'}>
                    <select id="direction" name="direction" className="select" value={direction} onChange={(e) => setDirection(e.target.value)}>
                      <option value="naik">Meningkat</option>
                      <option value="turun">Menurun</option>
                    </select>
                  </Field>
                  <Field label="Nilai awal" name="start_value" error={errors.start_value} hint={direction === 'turun' ? 'Mis. sisa utang saat ini' : 'Dana yang sudah benar-benar dialokasikan'}>
                    <input id="start_value" name="start_value" inputMode="decimal" className={`input${errClass(errors, 'start_value')}`} defaultValue={initial.start_value} />
                  </Field>
                  <Field label="Nilai target" name="target_value" error={errors.target_value} hint={metric === 'rupiah' ? 'Boleh pakai titik: 100.000.000' : undefined}>
                    <input id="target_value" name="target_value" inputMode="decimal" className={`input${errClass(errors, 'target_value')}`} defaultValue={initial.target_value} required />
                  </Field>
                </>
              )}
            </div>
          )}
          <div className="form-grid form-grid-2">
            <Field label="Tanggal mulai" name="start_date" error={errors.start_date}>
              <input id="start_date" name="start_date" type="date" className={`input${errClass(errors, 'start_date')}`} defaultValue={initial.start_date} required />
            </Field>
            <Field label="Tenggat" name="due_date" error={errors.due_date} hint="Opsional">
              <input id="due_date" name="due_date" type="date" className={`input${errClass(errors, 'due_date')}`} defaultValue={initial.due_date} />
            </Field>
            <Field label="Prioritas" name="priority">
              <select id="priority" name="priority" className="select" defaultValue={initial.priority}>
                <option value="rendah">Rendah</option><option value="sedang">Sedang</option><option value="tinggi">Tinggi</option>
              </select>
            </Field>
            <Field label="Kategori" name="category" hint="Mis. Keuangan, Belajar, Kesehatan">
              <input id="category" name="category" className="input" defaultValue={initial.category} maxLength={60} />
            </Field>
          </div>
          {!editing && !binary && (
            <Field label="Tahapan (opsional)" name="milestones" hint={manual ? 'Pisahkan dengan titik koma. Contoh: 25jt; 50jt; 75jt; 100jt' : 'Jumlah item selesai. Contoh: 3; 5; 10'}>
              <input id="milestones" name="milestones" className="input" maxLength={500} placeholder={manual ? '25jt; 50jt; 75jt' : '3; 5; 10'} />
            </Field>
          )}
          <Field label="Deskripsi" name="description">
            <textarea id="description" name="description" className="textarea" rows={3} defaultValue={initial.description} maxLength={4000} placeholder="Kenapa target ini penting?" />
          </Field>
        </div>
      )}
    </FormModal>
  )
}

export function NewGoalButton({ today, label = 'Buat target', className = 'btn btn-primary' }: { today: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><Plus size={16} />{label}</button>
      {open && <GoalFormModal open={open} onClose={() => setOpen(false)} initial={blankGoal(today)} />}
    </>
  )
}

export function EditGoalButton({ initial }: { initial: GoalFormValues }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Ubah</button>
      {open && <GoalFormModal open={open} onClose={() => setOpen(false)} initial={initial} />}
    </>
  )
}

export function ContributionButton({ goalId, metric, today, direction }: { goalId: string; metric: string; today: string; direction: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Catat kontribusi</button>
      {open && (
        <FormModal open={open} onClose={() => setOpen(false)} action={addContribution} icon={<Plus size={18} />}
          title="Catat kontribusi" subtitle="Penambahan/pengurangan nilai target. Ini bukan transaksi pemasukan." submitLabel="Simpan">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="goal_id" value={goalId} />
              <Choices name="mode" label="Jenis kontribusi" options={direction === 'turun' ? [
                { value: 'kurang', title: 'Kurangi', desc: 'Mis. membayar cicilan utang' },
                { value: 'tambah', title: 'Tambah', desc: 'Koreksi bila nilai bertambah' },
              ] : [
                { value: 'tambah', title: 'Tambah', desc: 'Mis. menabung atau menambah capaian' },
                { value: 'kurang', title: 'Kurangi', desc: 'Koreksi atau penarikan' },
              ]} />
              <Field label={metric === 'rupiah' ? 'Jumlah (Rp)' : metric === 'durasi' ? 'Jumlah (menit)' : 'Jumlah'} name="amount" error={errors.amount}>
                <input id="amount" name="amount" inputMode="decimal" className={`input${errClass(errors, 'amount')}`} required placeholder={metric === 'rupiah' ? '500.000' : '1'} />
              </Field>
              <Field label="Tanggal" name="occurred_on" error={errors.occurred_on}>
                <input id="occurred_on" name="occurred_on" type="date" className="input" defaultValue={today} required />
              </Field>
              <Field label="Catatan" name="note" hint="Opsional, mis. sumber dana">
                <input id="note" name="note" className="input" maxLength={500} />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

export function MilestoneButton({ goalId, hint }: { goalId: string; hint: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Plus size={15} />Tahapan</button>
      {open && (
        <FormModal open={open} onClose={() => setOpen(false)} action={addMilestone} size="sm" icon={<Flag size={18} />} title="Tambah tahapan" submitLabel="Tambah">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="goal_id" value={goalId} />
              <Field label="Ambang" name="threshold" error={errors.threshold} hint={hint}>
                <input id="threshold" name="threshold" inputMode="decimal" className={`input${errClass(errors, 'threshold')}`} required />
              </Field>
              <Field label="Nama tahapan" name="title" hint="Opsional">
                <input id="title" name="title" className="input" maxLength={120} placeholder="Mis. Seperempat jalan" />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}
