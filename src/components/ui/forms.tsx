'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { ActionState } from '@/lib/action'
import { Modal, type ModalProps } from './Modal'
import { useToast } from './Toast'

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

/** Tombol kirim yang terkunci selama proses; label "Memproses…" bertahan sampai selesai (AsyncButton). */
export function SubmitButton({ children, variant = 'primary', size, block, loadingText = 'Memproses…', disabled }: {
  children: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' | 'lg'; block?: boolean; loadingText?: string; disabled?: boolean
}) {
  const { pending } = useFormStatus()
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

/** Menghubungkan form ke Server Action: toast hasil, callback sukses, dan kesalahan per field. */
export function useFormAction(action: FormAction, opts: { onSuccess?: (s: NonNullable<ActionState>) => void; silent?: boolean } = {}) {
  const [state, formAction] = useActionState(action, null)
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
  return { state, formAction, errors: state?.ok === false ? state.errors ?? {} : {} }
}

/** Modal berisi form yang dikirim ke Server Action. Tertutup otomatis bila berhasil. */
export function FormModal({ action, onClose, submitLabel = 'Simpan', children, redirectTo, ...modal }: Omit<ModalProps, 'children' | 'footer' | 'as'> & {
  action: FormAction
  submitLabel?: string
  redirectTo?: (id: string) => string
  children: (errors: Record<string, string>) => React.ReactNode
}) {
  const router = useRouter()
  const { state, formAction, errors } = useFormAction(action, {
    onSuccess: (s) => {
      onClose()
      if (redirectTo && s.id) router.push(redirectTo(s.id))
    },
  })
  return (
    <Modal
      {...modal}
      onClose={onClose}
      as={(inner) => <form action={formAction} className="modal-form" noValidate>{inner}</form>}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
          <SubmitButton>{submitLabel}</SubmitButton>
        </>
      }
    >
      {state && !state.ok && state.errors && <p className="alert tone-err mb-5" role="alert">{state.message}</p>}
      {children(errors)}
    </Modal>
  )
}

export function errClass(errors: Record<string, string>, name: string) {
  return errors[name] ? ' has-error' : ''
}
