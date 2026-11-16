'use client'

import { BookOpen, CalendarClock, CheckSquare, Clock, NotebookPen, Plus, Target, Wallet } from 'lucide-react'
import { AccountFormModal, TransactionFormModal, emptyTx } from '@/app/(app)/keuangan/FinanceForms'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { loadQuickData, type QuickData } from '@/app/(app)/quick-data'
import { SessionFormModal, SubjectFormModal } from '@/app/(app)/belajar/LearningForms'
import { JournalFormModal, emptyJournal } from '@/app/(app)/jurnal/JournalForm'
import { GoalFormModal, blankGoal } from '@/app/(app)/target/GoalForm'
import { TaskFormModal, emptyTask } from '@/app/(app)/tugas/TaskForm'
import { useToast } from '@/components/ui/Toast'

export type QuickKind = 'tugas' | 'kegiatan' | 'catatan' | 'target' | 'sesi' | 'bidang' | 'transaksi' | 'rekening'
/** Tautan yang sudah terisi saat popup dibuka dari halaman tertentu (mis. detail target). */
type Preset = { goal_id?: string | null; subject_id?: string | null; project_id?: string | null }

interface QuickApi { open: (kind: QuickKind, preset?: Preset) => void; prefetch: () => void; pending: QuickKind | null }
const QuickContext = createContext<QuickApi>({ open: () => {}, prefetch: () => {}, pending: null })
const CACHE_MS = 60_000
export const useQuickAdd = () => useContext(QuickContext)

export const QUICK_ITEMS: Array<{ kind: QuickKind; label: string; desc: string; icon: React.ReactNode; color: string }> = [
  { kind: 'tugas', label: 'Tugas', desc: 'Tenggat, prioritas & subtugas', icon: <CheckSquare size={17} />, color: 'var(--c-blue)' },
  { kind: 'kegiatan', label: 'Kegiatan', desc: 'Jadwal jam mulai–selesai', icon: <CalendarClock size={17} />, color: 'var(--c-lilac)' },
  { kind: 'transaksi', label: 'Transaksi', desc: 'Pemasukan, pengeluaran, transfer', icon: <Wallet size={17} />, color: 'var(--c-peach)' },
  { kind: 'catatan', label: 'Catatan', desc: 'Catatan & jurnal', icon: <NotebookPen size={17} />, color: 'var(--c-rose)' },
  { kind: 'sesi', label: 'Sesi belajar', desc: 'Durasi, ringkasan & posisi', icon: <Clock size={17} />, color: 'var(--c-peach)' },
  { kind: 'target', label: 'Target', desc: 'Target & tahapannya', icon: <Target size={17} />, color: 'var(--c-blue)' },
  { kind: 'bidang', label: 'Bidang belajar', desc: 'Bidang & daftar modul', icon: <BookOpen size={17} />, color: 'var(--c-lilac)' },
]

/** Satu tempat untuk semua popup "tambah": dipakai menu topbar dan tombol cepat di halaman. */
export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<{ kind: QuickKind; preset: Preset; key: number; data: QuickData } | null>(null)
  const [pending, setPending] = useState<QuickKind | null>(null)
  const [, start] = useTransition()
  const toast = useToast()
  // Data pilihan dimuat di latar (saat menu dibuka / tombol disorot) agar popup langsung terbuka.
  const cache = useRef<{ at: number; promise: Promise<QuickData | null> } | null>(null)
  const fetchData = useCallback((force = false) => {
    const c = cache.current
    if (!force && c && Date.now() - c.at < CACHE_MS) return c.promise
    const promise = loadQuickData().catch(() => null)
    cache.current = { at: Date.now(), promise }
    promise.then((d) => { if (!d && cache.current?.promise === promise) cache.current = null })
    return promise
  }, [])
  const prefetch = useCallback(() => { void fetchData() }, [fetchData])

  const open = useCallback((kind: QuickKind, preset: Preset = {}) => {
    setPending(kind)
    start(async () => {
      try {
        const data = await fetchData()
        if (!data) { toast.error('Koneksi bermasalah atau sesi berakhir. Coba lagi.'); return }
        if (kind === 'transaksi' && data.accounts.length === 0) {
          toast.info('Tambahkan rekening terlebih dahulu, lalu catat transaksinya.')
          setActive({ kind: 'rekening', preset, key: Date.now(), data })
          return
        }
        if (kind === 'sesi' && data.bundles.length === 0) {
          toast.info('Buat bidang belajar terlebih dahulu, lalu catat sesinya.')
          setActive({ kind: 'bidang', preset, key: Date.now(), data })
          return
        }
        setActive({ kind, preset, key: Date.now(), data })
      } catch {
        toast.error('Koneksi bermasalah. Coba lagi.')
      } finally {
        setPending(null)
      }
    })
  }, [toast, fetchData])

  const api = useMemo(() => ({ open, prefetch, pending }), [open, prefetch, pending])
  // Setelah popup ditutup (mungkin ada data baru), pilihan dimuat ulang pada pembukaan berikutnya.
  const close = () => { setActive(null); cache.current = null }
  const a = active
  return (
    <QuickContext.Provider value={api}>
      {children}
      {a && (a.kind === 'tugas' || a.kind === 'kegiatan') && (
        <TaskFormModal key={a.key} open onClose={close} options={a.data.options} initial={emptyTask(a.kind, a.preset)} />
      )}
      {a?.kind === 'catatan' && (
        <JournalFormModal key={a.key} open onClose={close} goals={a.data.options.goals} subjects={a.data.options.subjects} initial={emptyJournal(a.data.today, a.preset)} />
      )}
      {a?.kind === 'target' && <GoalFormModal key={a.key} open onClose={close} initial={blankGoal(a.data.today)} />}
      {a?.kind === 'sesi' && (
        <SessionFormModal key={a.key} open onClose={close} subjects={a.data.bundles} today={a.data.today} defaultSubjectId={a.preset.subject_id ?? undefined} />
      )}
      {a?.kind === 'transaksi' && (
        <TransactionFormModal key={a.key} open onClose={close} accounts={a.data.accounts} categories={a.data.categories} initial={emptyTx(a.data.today, a.data.accounts)} />
      )}
      {a?.kind === 'rekening' && <AccountFormModal key={a.key} open onClose={close} initial={{ name: '', kind: 'bank', opening_balance: 0 }} />}
      {a?.kind === 'bidang' && (
        <SubjectFormModal key={a.key} open onClose={close} goals={a.data.options.goals} initial={{ title: '', description: '', goal_id: null, status: 'aktif' }} />
      )}
    </QuickContext.Provider>
  )
}

/** Tombol yang membuka popup tambah tertentu (untuk Server Component). */
export function QuickAddButton({ kind, label, className = 'btn btn-secondary', preset }: { kind: QuickKind; label: string; className?: string; preset?: Preset }) {
  const { open, prefetch, pending } = useQuickAdd()
  const busy = pending === kind
  return (
    <button type="button" className={className} disabled={busy} aria-busy={busy} onClick={() => open(kind, preset)}
      onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <Plus size={16} />}{label}
    </button>
  )
}

/** Menu "Tambah" di topbar. */
export function QuickAddMenu() {
  const { open, prefetch, pending } = useQuickAdd()
  const [show, setShow] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!show) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setShow(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShow(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.menu-item')?.focus())
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [show])
  return (
    <div ref={root} className="relative">
      <button type="button" className="btn btn-primary btn-sm" aria-haspopup="menu" aria-expanded={show} disabled={!!pending}
        onPointerEnter={prefetch} onFocus={prefetch} onClick={() => { prefetch(); setShow((v) => !v) }}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <Plus size={16} />}<span className="max-sm:sr-only">Tambah</span>
      </button>
      {show && (
        <div className="menu" role="menu" aria-label="Tambah baru">
          {QUICK_ITEMS.map((it) => (
            <button key={it.kind} type="button" role="menuitem" className="menu-item" onClick={() => { setShow(false); open(it.kind) }}>
              <span className="menu-icon" style={{ color: it.color, background: `color-mix(in srgb, ${it.color} 10%, transparent)` }} aria-hidden="true">{it.icon}</span>
              <span className="min-w-0"><span className="menu-label">{it.label}</span><span className="menu-desc">{it.desc}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
