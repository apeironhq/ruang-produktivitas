'use client'

import { CircleCheck, CircleX, Info, Undo2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Toast sementara: satu pesan aktif, hilang otomatis setelah 5 detik.
 * Pesan baru menggantikan pesan lama dan mengulang timer (tidak bertumpuk).
 * withUndo: toast bertombol "Urungkan" — onCommit dijalankan saat toast habis/ditutup/diganti
 * (atau halaman ditinggalkan), onUndo saat pengguna menekan Urungkan.
 */
type ToastType = 'success' | 'error' | 'info'
interface Undoable { onCommit?: () => void; onUndo: () => void }
interface ToastState { id: number; type: ToastType; message: string; undo?: Undoable }
interface ToastApi {
  success: (m: string) => void; error: (m: string) => void; info: (m: string) => void
  withUndo: (m: string, u: Undoable) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const DURATION = 5000
const icons = { success: CircleCheck, error: CircleX, info: Info }
const tones = { success: 'tone-ok', error: 'tone-err', info: 'tone-brand' }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  // Aksi yang menunggu (mis. hapus tertunda) — dijalankan sekali saat toast-nya berakhir.
  const pendingCommit = useRef<(() => void) | null>(null)
  const flush = useCallback(() => {
    const c = pendingCommit.current
    pendingCommit.current = null
    c?.()
  }, [])

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    flush()
    setCurrent(null)
  }, [flush])
  const show = useCallback((type: ToastType, message: string, undo?: Undoable) => {
    if (timer.current) clearTimeout(timer.current)
    flush()
    pendingCommit.current = undo?.onCommit ?? null
    setCurrent({ id: ++seq.current, type, message, undo })
    timer.current = setTimeout(() => { flush(); setCurrent(null); timer.current = null }, DURATION)
  }, [flush])
  const undoNow = useCallback((u: Undoable) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pendingCommit.current = null
    setCurrent(null)
    u.onUndo()
  }, [])
  useEffect(() => {
    // Tab ditutup / dimuat ulang sebelum toast habis → tetap jalankan aksinya (sebisanya).
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); if (timer.current) clearTimeout(timer.current) }
  }, [flush])

  const api = useMemo<ToastApi>(() => ({
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
    withUndo: (m, u) => show('success', m, u),
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
            {current.undo && <button className="toast-undo" type="button" onClick={() => undoNow(current.undo!)}><Undo2 size={15} aria-hidden="true" />Urungkan</button>}
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
