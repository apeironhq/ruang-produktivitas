'use client'

import { Check, Pencil, Plus, Repeat } from 'lucide-react'
import { useState } from 'react'
import { useOptimisticToggle } from '@/components/ui/actions'
import { Choices, Field, FormModal, errClass } from '@/components/ui/forms'
import { saveHabit, setCheckin } from './actions'

export interface HabitValues { id?: string; name: string; description: string; frequency: 'harian' | 'mingguan'; times_per_week: number }
export const emptyHabit = (): HabitValues => ({ name: '', description: '', frequency: 'harian', times_per_week: 3 })

export function HabitFormModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: HabitValues }) {
  const [freq, setFreq] = useState(initial.frequency)
  const editing = !!initial.id
  return (
    <FormModal open={open} onClose={onClose} action={saveHabit} icon={<Repeat size={18} />}
      title={editing ? 'Ubah kebiasaan' : 'Kebiasaan baru'} subtitle="Check-in setiap kali dilakukan; streak dihitung otomatis."
      submitLabel={editing ? 'Simpan perubahan' : 'Tambah kebiasaan'}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <Field label="Nama kebiasaan" name="name" error={errors.name}>
            <input id="name" name="name" className={`input${errClass(errors, 'name')}`} defaultValue={initial.name} maxLength={80} required placeholder="Mis. Olahraga 30 menit, Baca Al-Qur'an, Tidur sebelum 23.00" />
          </Field>
          <Choices name="frequency" label="Frekuensi" value={freq} onChange={(v) => setFreq(v as HabitValues['frequency'])} options={[
            { value: 'harian', title: 'Harian', desc: 'Setiap hari — streak dihitung per hari' },
            { value: 'mingguan', title: 'Mingguan', desc: 'Beberapa kali dalam seminggu' },
          ]} />
          {freq === 'mingguan' && (
            <Field label="Berapa kali per minggu" name="times_per_week" error={errors.times_per_week}>
              <select id="times_per_week" name="times_per_week" className="select" defaultValue={String(initial.times_per_week)}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}× per minggu</option>)}
              </select>
            </Field>
          )}
          <Field label="Catatan" name="description" hint="Opsional, mis. alasan atau pemicunya">
            <input id="description" name="description" className="input" defaultValue={initial.description} maxLength={500} />
          </Field>
        </div>
      )}
    </FormModal>
  )
}

export function NewHabitButton({ label = 'Kebiasaan baru', className = 'btn btn-primary' }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <>
      <button type="button" className={className} onClick={() => { setKey((k) => k + 1); setOpen(true) }}><Plus size={16} />{label}</button>
      {open && <HabitFormModal key={key} open onClose={() => setOpen(false)} initial={emptyHabit()} />}
    </>
  )
}

export function EditHabitButton({ initial }: { initial: HabitValues }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Ubah ${initial.name}`} onClick={() => setOpen(true)}><Pencil size={15} /></button>
      {open && <HabitFormModal open onClose={() => setOpen(false)} initial={initial} />}
    </>
  )
}

/** Tombol check-in hari ini (besar). */
export function CheckTodayButton({ habitId, name, today, done }: { habitId: string; name: string; today: string; done: boolean }) {
  const c = useOptimisticToggle(done)
  return (
    <button type="button" className={`habit-check${c.checked ? ' done' : ''}`} disabled={c.pending} aria-busy={c.pending} aria-pressed={c.checked}
      aria-label={c.checked ? `Batalkan check-in hari ini: ${name}` : `Check-in hari ini: ${name}`}
      onClick={() => c.toggle((next) => setCheckin(habitId, today, next))}>
      <Check size={20} strokeWidth={2.6} aria-hidden="true" />
    </button>
  )
}

/** Titik satu hari pada strip 7 hari terakhir (bisa diklik untuk mengisi hari yang terlewat). */
export function DayDot({ habitId, day, label, done, isToday }: { habitId: string; day: string; label: string; done: boolean; isToday: boolean }) {
  const c = useOptimisticToggle(done)
  return (
    <button type="button" className={`day-dot${c.checked ? ' done' : ''}${isToday ? ' today' : ''}`} disabled={c.pending} aria-busy={c.pending} aria-pressed={c.checked}
      title={label} aria-label={`${label}: ${c.checked ? 'sudah' : 'belum'} check-in`}
      onClick={() => c.toggle((next) => setCheckin(habitId, day, next))}>
      <span className="day-dot-label" aria-hidden="true">{label.split(' ')[0]}</span>
      <span className="day-dot-mark" aria-hidden="true">{c.checked && <Check size={11} strokeWidth={3} />}</span>
    </button>
  )
}
