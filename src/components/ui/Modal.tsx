'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

const noopSubscribe = () => () => {}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg'
  closable?: boolean
  icon?: React.ReactNode
  tone?: 'brand' | 'danger'
  children: React.ReactNode
  footer?: React.ReactNode
  /** Bungkus isi + footer dalam elemen ini (mis. <form>) */
  as?: (inner: React.ReactNode) => React.ReactNode
}

export function Modal({ open, onClose, title, subtitle, size = 'md', closable = true, icon, tone = 'brand', children, footer, as }: ModalProps) {
  const dialog = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  // true hanya di browser (portal butuh document); false saat render server.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  // Ref agar fungsi onClose baru di tiap render tidak memicu ulang efek (fokus tidak melompat).
  const closeRef = useRef(onClose)
  const closableRef = useRef(closable)
  useEffect(() => { closeRef.current = onClose; closableRef.current = closable })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && closableRef.current) closeRef.current() }
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => {
      dialog.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not(.modal-close)')?.focus()
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open])

  if (!open || !mounted) return null
  const inner = (
    <>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </>
  )
  return createPortal(
    <div className="modal-root" onMouseDown={(e) => { if (e.target === e.currentTarget && closable) onClose() }}>
      <div ref={dialog} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          {icon && <span className={`modal-icon${tone === 'danger' ? ' danger' : ''}`} aria-hidden="true">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="text-caption mt-0.5">{subtitle}</p>}
          </div>
          {closable && <button className="modal-close" type="button" aria-label="Tutup" onClick={onClose}><X size={18} /></button>}
        </header>
        {as ? as(inner) : inner}
      </div>
    </div>,
    document.body,
  )
}
