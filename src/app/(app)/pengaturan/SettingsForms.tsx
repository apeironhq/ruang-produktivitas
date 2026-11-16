'use client'

import { useRef } from 'react'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { updatePassword } from '@/app/(auth)/actions'
import { saveProfile } from './actions'

const ZONES = [
  { value: 'Asia/Jakarta', label: 'WIB — Asia/Jakarta' },
  { value: 'Asia/Makassar', label: 'WITA — Asia/Makassar' },
  { value: 'Asia/Jayapura', label: 'WIT — Asia/Jayapura' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Asia/Kuala_Lumpur', label: 'Asia/Kuala_Lumpur' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'UTC', label: 'UTC' },
]

export function ProfileForm({ name, timezone, email }: { name: string; timezone: string; email: string }) {
  const { onSubmit, pending, errors } = useFormAction(saveProfile)
  const zones = ZONES.some((z) => z.value === timezone) ? ZONES : [{ value: timezone, label: timezone }, ...ZONES]
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label="Email" name="email" hint="Email dipakai untuk masuk dan tidak dapat diubah di sini.">
        <input id="email" className="input" value={email} disabled readOnly />
      </Field>
      <Field label="Nama tampilan" name="display_name" error={errors.display_name}>
        <input id="display_name" name="display_name" className={`input${errClass(errors, 'display_name')}`} defaultValue={name} maxLength={80} required />
      </Field>
      <Field label="Zona waktu" name="timezone" error={errors.timezone} hint="Dipakai untuk tanggal, tenggat, kalender, dan pengingat.">
        <select id="timezone" name="timezone" className="select" defaultValue={timezone}>
          {zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
      </Field>
      <div><SubmitButton pending={pending}>Simpan profil</SubmitButton></div>
    </form>
  )
}

export function PasswordForm() {
  const form = useRef<HTMLFormElement | null>(null)
  const { onSubmit, pending, errors } = useFormAction(updatePassword, { onSuccess: () => form.current?.reset() })
  return (
    <form ref={form} onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label="Password baru" name="password" error={errors.password} hint="Minimal 8 karakter.">
        <input id="password" name="password" type="password" autoComplete="new-password" className={`input${errClass(errors, 'password')}`} required />
      </Field>
      <Field label="Ulangi password baru" name="confirm" error={errors.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={`input${errClass(errors, 'confirm')}`} required />
      </Field>
      <div><SubmitButton pending={pending} variant="secondary">Ganti password</SubmitButton></div>
    </form>
  )
}
