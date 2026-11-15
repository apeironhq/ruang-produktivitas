'use client'

import { CircleCheck, CircleX, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Toast sementara: satu pesan aktif, hilang otomatis setelah 5 detik.
 * Pesan baru menggantikan pesan lama dan mengulang timer (tidak bertumpuk).
 */
type ToastType = 'success' | 'error' | 'info'
interface ToastState { id: number; type: ToastType; message: string }
interface ToastApi { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

const ToastContext = createContext<ToastApi | null>(null)
const DURATION = 5000
const icons = { success: CircleCheck, error: CircleX, info: Info }
const tones = { success: 'tone-ok', error: 'tone-err', info: 'tone-brand' }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setCurrent(null)
  }, [])
  const show = useCallback((type: ToastType, message: string) => {
    if (timer.current) clearTimeout(timer.current)
    setCurrent({ id: ++seq.current, type, message })
    timer.current = setTimeout(() => { setCurrent(null); timer.current = null }, DURATION)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const api = useMemo<ToastApi>(() => ({
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
  }), [show])

  const Icon = current ? icons[current.type] : null
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite" aria-atomic="true">
        {current && Icon && (
          <div key={current.id} className={`toast ${tones[current.type]}`} data-testid="toast">
            <Icon className="toast-icon" size={19} />
            <p className="toast-msg">{current.message}</p>
            <button className="toast-close" type="button" aria-label="Tutup notifikasi" onClick={dismiss}><X size={15} /></button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast harus dipakai di dalam ToastProvider')
  return ctx
}
