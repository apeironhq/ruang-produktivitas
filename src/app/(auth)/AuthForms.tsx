'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { requestPasswordReset, signIn, signUp, updatePassword } from './actions'

function PasswordInput({ id, name, autoComplete, error }: { id: string; name: string; autoComplete: string; error?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input id={id} name={name} className={`input input-pw${error ? ' has-error' : ''}`} type={show ? 'text' : 'password'} autoComplete={autoComplete} required
        aria-invalid={!!error} aria-describedby={error ? `${name}-err` : undefined} />
      <button type="button" className="pw-toggle" aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShow((v) => !v)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  )
}

export function SignInForm({ next, notice }: { next: string; notice: string }) {
  const { state, onSubmit, pending, errors } = useFormAction(signIn, { silent: true })
  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-2">Masuk</h1>
        <p className="text-caption">Masuk untuk membuka ruang produktivitas Anda.</p>
      </div>
      {notice && <div className="alert mb-5" role="status">{notice}</div>}
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" error={errors.email}>
          <input id="email" name="email" className={`input${errClass(errors, 'email')}`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
        </Field>
        <Field label="Password" name="password" error={errors.password}>
          <PasswordInput id="password" name="password" autoComplete="current-password" error={errors.password} />
        </Field>
        {state && !state.ok && !state.errors && <p className="alert tone-err" role="alert">{state.message}</p>}
        <SubmitButton pending={pending} size="lg" block>Masuk</SubmitButton>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-caption">
        <Link href="/lupa-password" className="link">Lupa password?</Link>
        <p>Belum punya akun? <Link href="/daftar" className="link">Daftar</Link></p>
      </div>
    </div>
  )
}

export function SignUpForm() {
  const { state, onSubmit, pending, errors } = useFormAction(signUp, { silent: true })
  if (state?.ok) {
    return (
      <div>
        <h1 className="mb-2">Cek email Anda</h1>
        <p className="alert mt-5" role="status">{state.message}</p>
        <Link href="/masuk" className="btn btn-primary btn-lg btn-block mt-6">Ke halaman masuk</Link>
      </div>
    )
  }
  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-2">Daftar</h1>
        <p className="text-caption">Buat akun pribadi. Data Anda hanya bisa diakses oleh Anda.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Nama" name="display_name" error={errors.display_name}>
          <input id="display_name" name="display_name" className={`input${errClass(errors, 'display_name')}`} autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="Email" name="email" error={errors.email}>
          <input id="email" name="email" className={`input${errClass(errors, 'email')}`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
        </Field>
        <Field label="Password" name="password" error={errors.password} hint="Minimal 8 karakter.">
          <PasswordInput id="password" name="password" autoComplete="new-password" error={errors.password} />
        </Field>
        {state && !state.ok && !state.errors && <p className="alert tone-err" role="alert">{state.message}</p>}
        {errors.email === 'Email ini sudah terdaftar.' && (
          <div className="alert tone-warn" role="alert">
            <p><strong>Email ini sudah terdaftar.</strong> Silakan masuk dengan akun tersebut.</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/masuk" className="link">Masuk</Link>
              <Link href="/lupa-password" className="link">Lupa password?</Link>
            </p>
          </div>
        )}
        <SubmitButton pending={pending} size="lg" block>Buat akun</SubmitButton>
      </form>
      <p className="mt-6 text-center text-caption">Sudah punya akun? <Link href="/masuk" className="link">Masuk</Link></p>
    </div>
  )
}

export function ForgotForm() {
  const { state, onSubmit, pending, errors } = useFormAction(requestPasswordReset, { silent: true })
  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-2">Lupa password</h1>
        <p className="text-caption">Masukkan email akun Anda. Kami kirim tautan untuk membuat password baru.</p>
      </div>
      {state?.ok ? <p className="alert" role="status">{state.message}</p> : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <Field label="Email" name="email" error={errors.email}>
            <input id="email" name="email" className={`input${errClass(errors, 'email')}`} type="email" autoComplete="email" required />
          </Field>
          <SubmitButton pending={pending} size="lg" block>Kirim tautan</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-center text-caption"><Link href="/masuk" className="link">Kembali ke halaman masuk</Link></p>
    </div>
  )
}

export function ResetPasswordForm() {
  const router = useRouter()
  const { state, onSubmit, pending, errors } = useFormAction(updatePassword, { onSuccess: () => router.push('/') })
  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-2">Atur password baru</h1>
        <p className="text-caption">Gunakan minimal 8 karakter.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Password baru" name="password" error={errors.password}>
          <PasswordInput id="password" name="password" autoComplete="new-password" error={errors.password} />
        </Field>
        <Field label="Ulangi password" name="confirm" error={errors.confirm}>
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" error={errors.confirm} />
        </Field>
        {state && !state.ok && !state.errors && <p className="alert tone-err" role="alert">{state.message}</p>}
        <SubmitButton pending={pending} size="lg" block>Simpan password</SubmitButton>
      </form>
    </div>
  )
}
