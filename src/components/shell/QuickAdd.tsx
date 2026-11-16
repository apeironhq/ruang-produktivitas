'use client'

import { Plus } from 'lucide-react'
import { HabitFormModal, emptyHabit } from '@/app/(app)/kebiasaan/HabitForms'
import { ProjectFormModal, emptyProject } from '@/app/(app)/proyek/ProjectForms'
import { AccountFormModal, TransactionFormModal, emptyTx } from '@/app/(app)/keuangan/FinanceForms'
import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition } from 'react'
import { loadQuickData, type QuickData } from '@/app/(app)/quick-data'
import { SessionFormModal, SubjectFormModal } from '@/app/(app)/belajar/LearningForms'
import { JournalFormModal, emptyJournal, type JournalValues } from '@/app/(app)/jurnal/JournalForm'
import { GoalFormModal, blankGoal } from '@/app/(app)/target/GoalForm'
import { TaskFormModal, emptyTask, type TaskFormValues } from '@/app/(app)/tugas/TaskForm'
import { useToast } from '@/components/ui/Toast'

export type QuickKind = 'tugas' | 'kegiatan' | 'catatan' | 'target' | 'sesi' | 'bidang' | 'transaksi' | 'rekening' | 'proyek' | 'kebiasaan'
/** Tautan yang sudah terisi saat popup dibuka dari halaman tertentu (mis. detail target). */
type Preset = { goal_id?: string | null; subject_id?: string | null; project_id?: string | null }

/** Ubah data yang sudah ada dari daftar (tanpa membuka halaman detail). */
export type EditTarget = { kind: 'tugas'; values: TaskFormValues } | { kind: 'catatan'; values: JournalValues }
interface QuickApi { open: (kind: QuickKind, preset?: Preset) => void; edit: (t: EditTarget) => void; prefetch: () => void; pending: QuickKind | null }
const QuickContext = createContext<QuickApi>({ open: () => {}, edit: () => {}, prefetch: () => {}, pending: null })
const CACHE_MS = 60_000
export const useQuickAdd = () => useContext(QuickContext)

/** Satu tempat untuk semua popup "tambah": dipakai menu topbar dan tombol cepat di halaman. */
export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<{ kind: QuickKind; preset: Preset; key: number; data: QuickData; editing?: EditTarget } | null>(null)
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

  const edit = useCallback((target: EditTarget) => {
    setPending(target.kind)
    start(async () => {
      try {
        const data = await fetchData()
        if (!data) { toast.error('Koneksi bermasalah atau sesi berakhir. Coba lagi.'); return }
        setActive({ kind: target.kind, preset: {}, key: Date.now(), data, editing: target })
      } catch {
        toast.error('Koneksi bermasalah. Coba lagi.')
      } finally {
        setPending(null)
      }
    })
  }, [toast, fetchData])

  const api = useMemo(() => ({ open, edit, prefetch, pending }), [open, edit, prefetch, pending])
  // Setelah popup ditutup (mungkin ada data baru), pilihan dimuat ulang pada pembukaan berikutnya.
  const close = () => { setActive(null); cache.current = null }
  const a = active
  return (
    <QuickContext.Provider value={api}>
      {children}
      {a && (a.kind === 'tugas' || a.kind === 'kegiatan') && (
        <TaskFormModal key={a.key} open onClose={close} options={a.data.options} initial={a.editing?.kind === 'tugas' ? a.editing.values : emptyTask(a.kind, a.preset)} />
      )}
      {a?.kind === 'catatan' && (
        <JournalFormModal key={a.key} open onClose={close} goals={a.data.options.goals} subjects={a.data.options.subjects} projects={a.data.options.projects} initial={a.editing?.kind === 'catatan' ? a.editing.values : emptyJournal(a.data.today, a.preset)} />
      )}
      {a?.kind === 'target' && <GoalFormModal key={a.key} open onClose={close} initial={blankGoal(a.data.today)} />}
      {a?.kind === 'proyek' && <ProjectFormModal key={a.key} open onClose={close} initial={emptyProject(a.data.today)} goals={a.data.options.goals} />}
      {a?.kind === 'sesi' && (
        <SessionFormModal key={a.key} open onClose={close} subjects={a.data.bundles} today={a.data.today} defaultSubjectId={a.preset.subject_id ?? undefined} />
      )}
      {a?.kind === 'transaksi' && (
        <TransactionFormModal key={a.key} open onClose={close} accounts={a.data.accounts} categories={a.data.categories} initial={emptyTx(a.data.today, a.data.accounts)} />
      )}
      {a?.kind === 'rekening' && <AccountFormModal key={a.key} open onClose={close} initial={{ name: '', kind: 'bank', opening_balance: 0 }} />}
      {a?.kind === 'kebiasaan' && <HabitFormModal key={a.key} open onClose={close} initial={emptyHabit()} />}
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
