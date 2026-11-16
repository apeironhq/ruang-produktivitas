'use client'

import { startTransition, useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { ActionState } from '@/lib/action'
import { Modal, type ModalProps } from './Modal'
import { useToast } from './Toast'

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

/** Tombol kirim yang terkunci selama proses; label "Memproses…" bertahan sampai selesai (AsyncButton). */
export function SubmitButton({ children, variant = 'primary', size, block, loadingText = 'Memproses…', disabled, pending: pendingProp }: {
  children: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' | 'lg'; block?: boolean; loadingText?: string; disabled?: boolean
  /** status proses dari useFormAction (form ber-onSubmit tidak terbaca useFormStatus) */
  pending?: boolean
}) {
  const status = useFormStatus()
  const pending = pendingProp ?? status.pending
  return (
    <button type="submit" className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}`} disabled={pending || disabled} aria-busy={pending}>
      {pending ? <><span className="spinner" aria-hidden="true" /><span>{loadingText}</span></> : children}
    </button>
  )
}

export function Field({ label, name, error, hint, children, className = '' }: {
  label: string; name?: string; error?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={name}>{label}</label>
      {children}
      {error ? <p className="field-error" id={name ? `${name}-err` : undefined}>{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

/**
 * Menghubungkan form ke Server Action: toast hasil, callback sukses, dan kesalahan per field.
 *
 * Pakai `onSubmit` (bukan `action={formAction}`): React 19 otomatis mengosongkan form setelah
 * `<form action>` selesai — termasuk saat validasi gagal, sehingga isian pengguna hilang.
 * Dengan onSubmit + startTransition, isian tetap ada sampai form ditutup/direset sendiri.
 */
export function useFormAction(action: FormAction, opts: { onSuccess?: (s: NonNullable<ActionState>) => void; silent?: boolean } = {}) {
  const [state, formAction, pending] = useActionState(action, null)
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending) return
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)
    startTransition(() => formAction(fd))
  }
  const toast = useToast()
  const last = useRef(0)
  const onSuccess = useRef(opts.onSuccess)
  useEffect(() => { onSuccess.current = opts.onSuccess })
  useEffect(() => {
    if (!state || state.ts === last.current) return
    last.current = state.ts
    if (state.ok) {
      if (!opts.silent) toast.success(state.message)
      onSuccess.current?.(state)
    } else if (!state.errors) {
      toast.error(state.message)
    }
  }, [state, toast, opts.silent])
  return { state, formAction, onSubmit, pending, errors: state?.ok === false ? state.errors ?? {} : {} }
}

/** Modal berisi form yang dikirim ke Server Action. Tertutup otomatis bila berhasil. */
export function FormModal({ action, onClose, submitLabel = 'Simpan', children, redirectTo, ...modal }: Omit<ModalProps, 'children' | 'footer' | 'as'> & {
  action: FormAction
  submitLabel?: string
  redirectTo?: (id: string) => string
  children: (errors: Record<string, string>) => React.ReactNode
}) {
  const router = useRouter()
  const { state, onSubmit, pending, errors } = useFormAction(action, {
    onSuccess: (s) => {
      onClose()
      if (redirectTo && s.id) router.push(redirectTo(s.id))
    },
  })
  return (
    <Modal
      {...modal}
      onClose={onClose}
      as={(inner) => <form onSubmit={onSubmit} className="modal-form" noValidate>{inner}</form>}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
          <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        </>
      }
    >
      {state && !state.ok && state.errors && <p className="alert tone-err mb-5" role="alert">{state.message}</p>}
      {children(errors)}
    </Modal>
  )
}

/** Pilihan radio berbingkai (pola InvitationPicker MDUNDIG). Terkontrol bila `value` + `onChange` diberikan. */
export function Choices({ name, label, options, value, defaultValue, onChange, error, columns = 2 }: {
  name: string; label: string; options: Array<{ value: string; title: string; desc?: string }>
  value?: string; defaultValue?: string; onChange?: (v: string) => void; error?: string; columns?: 1 | 2 | 3
}) {
  return (
    <fieldset className="field">
      <legend className="field-label mb-2">{label}</legend>
      <div className={`choices${columns > 1 ? ` choices-${columns}` : ''}`}>
        {options.map((o) => (
          <label key={o.value} className="choice">
            <input type="radio" name={name} value={o.value}
              {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: (defaultValue ?? options[0]?.value) === o.value })} />
            <span className="min-w-0">
              <span className="choice-title">{o.title}</span>
              {o.desc && <span className="choice-desc">{o.desc}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="field-error mt-1">{error}</p>}
    </fieldset>
  )
}

export function errClass(errors: Record<string, string>, name: string) {
  return errors[name] ? ' has-error' : ''
}
