'use client'

import { TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOptimistic, useState, useTransition } from 'react'
import type { ActionState } from '@/lib/action'
import { Modal } from './Modal'
import { useToast } from './Toast'

/** Menjalankan Server Action dari tombol (tanpa form), dengan toast & status memproses. */
export function useRunAction() {
  const [pending, start] = useTransition()
  const toast = useToast()
  const router = useRouter()
  function run(fn: () => Promise<ActionState>, opts: { silent?: boolean; redirect?: string; onDone?: () => void } = {}) {
    start(async () => {
      try {
        const res = await fn()
        if (!res) return
        if (res.ok) {
          if (!opts.silent) toast.success(res.message)
          opts.onDone?.()
          if (opts.redirect) router.push(opts.redirect)
        } else {
          toast.error(res.message)
        }
      } catch {
        toast.error('Koneksi bermasalah. Coba lagi.')
      }
    })
  }
  return { pending, run }
}

/**
 * Centang optimistis: tampilan langsung berubah saat diklik, server menyusul di belakang.
 * Bila server gagal, useOptimistic otomatis mengembalikan nilai lama dan toast galat muncul.
 */
export function useOptimisticToggle(value: boolean) {
  const [checked, setChecked] = useOptimistic(value)
  const [pending, start] = useTransition()
  const toast = useToast()
  function toggle(fn: (next: boolean) => Promise<ActionState>) {
    start(async () => {
      const next = !checked
      setChecked(next)
      try {
        const res = await fn(next)
        if (!res?.ok) toast.error(res?.message ?? 'Gagal menyimpan. Coba lagi.')
      } catch {
        toast.error('Koneksi bermasalah. Coba lagi.')
      }
    })
  }
  return { checked, pending, toggle }
}

/** Tombol yang menjalankan aksi langsung (mis. arsipkan). */
export function ActionButton({ action, children, className = 'btn btn-secondary', silent, redirect, title, ariaLabel }: {
  action: () => Promise<ActionState>; children: React.ReactNode; className?: string; silent?: boolean; redirect?: string; title?: string; ariaLabel?: string
}) {
  const { pending, run } = useRunAction()
  return (
    <button type="button" className={className} disabled={pending} aria-busy={pending} title={title} aria-label={ariaLabel}
      onClick={() => run(action, { silent, redirect })}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

/** Tombol hapus/cabut dengan dialog konfirmasi (ConfirmDialog). */
export function ConfirmButton({ action, title, message, confirmLabel = 'Hapus', children, className = 'btn btn-danger-ghost', redirect, ariaLabel }: {
  action: () => Promise<ActionState>; title: string; message: string; confirmLabel?: string; children: React.ReactNode; className?: string; redirect?: string; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const { pending, run } = useRunAction()
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={ariaLabel}>{children}</button>
      <Modal open={open} onClose={() => setOpen(false)} closable={!pending} icon={<TriangleAlert size={18} />} tone="danger" size="sm"
        title={title} subtitle="Tindakan ini tidak dapat dibatalkan."
        footer={
          <>
            <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>Batal</button>
            <button className="btn btn-danger" type="button" disabled={pending} aria-busy={pending}
              onClick={() => run(action, { redirect, onDone: () => setOpen(false) })}>
              {pending ? <><span className="spinner" aria-hidden="true" /><span>Memproses…</span></> : confirmLabel}
            </button>
          </>
        }>
        <p>{message}</p>
      </Modal>
    </>
  )
}
