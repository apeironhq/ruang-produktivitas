'use client'

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQuickAdd } from '@/components/shell/QuickAdd'
import { useToast } from '@/components/ui/Toast'
import type { ActionState } from '@/lib/action'
import type { JournalValues } from '@/app/(app)/jurnal/JournalForm'
import { deleteEntry, setArchived } from '@/app/(app)/jurnal/actions'
import type { TaskFormValues } from '@/app/(app)/tugas/TaskForm'
import { deleteTask } from '@/app/(app)/tugas/actions'

/* ---------- Baris yang bisa disembunyikan seketika (hapus/arsip dengan "Urungkan") ---------- */

const RowCtx = createContext<{ hide: () => void; show: () => void }>({ hide: () => {}, show: () => {} })

export function RemovableRow({ className, children }: { className?: string; children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false)
  return (
    <RowCtx.Provider value={{ hide: () => setHidden(true), show: () => setHidden(false) }}>
      <li className={className} hidden={hidden}>{children}</li>
    </RowCtx.Provider>
  )
}

/* ---------- Tampilan: ikon langsung di desktop, menu ⋯ di ponsel ---------- */

interface Item { key: string; label: string; icon: React.ReactNode; danger?: boolean; warn?: boolean; onSelect: () => void }

function ActionMenu({ items, label }: { items: Item[]; label: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={root} className="row-actions">
      <div className="row-actions-inline">
        {items.map((it) => (
          <button key={it.key} type="button" className={`row-act${it.danger ? ' danger' : it.warn ? ' warn' : ''}`} title={it.label} aria-label={`${it.label}: ${label}`} onClick={it.onSelect}>{it.icon}</button>
        ))}
      </div>
      <div className="row-actions-more relative">
        <button type="button" className="row-act" aria-haspopup="menu" aria-expanded={open} aria-label={`Aksi untuk ${label}`} onClick={() => setOpen((v) => !v)}>
          <MoreHorizontal size={18} />
        </button>
        {open && (
          <div className="menu row-menu" role="menu">
            {items.map((it) => (
              <button key={it.key} type="button" role="menuitem" className={`menu-item${it.danger ? ' menu-item-danger' : it.warn ? ' menu-item-warn' : ''}`} onClick={() => { setOpen(false); it.onSelect() }}>
                {it.icon}<span className="menu-label">{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Hapus seketika: baris hilang, toast "Urungkan" 5 detik, baru setelah itu benar-benar dihapus. */
function useUndoableDelete() {
  const row = useContext(RowCtx)
  const toast = useToast()
  return (message: string, commit: () => Promise<ActionState>) => {
    row.hide()
    toast.withUndo(message, {
      onUndo: () => row.show(),
      onCommit: () => {
        commit().then((r) => { if (!r?.ok) { row.show(); toast.error(r?.message ?? 'Gagal menghapus. Coba lagi.') } }).catch(() => { row.show(); toast.error('Gagal menghapus. Coba lagi.') })
      },
    })
  }
}

/* ---------- Tugas ---------- */

export function TaskRowActions({ id, title, values }: { id: string; title: string; values: TaskFormValues }) {
  const { edit } = useQuickAdd()
  const remove = useUndoableDelete()
  const noun = values.kind === 'kegiatan' ? 'Kegiatan' : 'Tugas'
  return (
    <ActionMenu label={title} items={[
      { key: 'ubah', label: 'Ubah', icon: <Pencil size={16} />, onSelect: () => edit({ kind: 'tugas', values }) },
      { key: 'hapus', label: 'Hapus', icon: <Trash2 size={16} />, danger: true, onSelect: () => remove(`${noun} dihapus.`, () => deleteTask(id)) },
    ]} />
  )
}

/* ---------- Catatan ---------- */

export function NoteRowActions({ id, title, archived, values }: { id: string; title: string; archived: boolean; values: JournalValues }) {
  const { edit } = useQuickAdd()
  const remove = useUndoableDelete()
  const row = useContext(RowCtx)
  const toast = useToast()
  function toggleArchive() {
    row.hide()
    setArchived(id, !archived).then((r) => {
      if (!r?.ok) { row.show(); toast.error(r?.message ?? 'Gagal menyimpan. Coba lagi.'); return }
      toast.withUndo(archived ? 'Dikembalikan dari arsip.' : 'Catatan diarsipkan.', {
        onUndo: () => { row.show(); void setArchived(id, archived) },
      })
    }).catch(() => { row.show(); toast.error('Koneksi bermasalah. Coba lagi.') })
  }
  return (
    <ActionMenu label={title} items={[
      { key: 'ubah', label: 'Ubah', icon: <Pencil size={16} />, onSelect: () => edit({ kind: 'catatan', values }) },
      { key: 'arsip', label: archived ? 'Kembalikan' : 'Arsipkan', icon: archived ? <ArchiveRestore size={16} /> : <Archive size={16} />, warn: !archived, onSelect: toggleArchive },
      { key: 'hapus', label: 'Hapus', icon: <Trash2 size={16} />, danger: true, onSelect: () => remove('Catatan dihapus.', () => deleteEntry(id)) },
    ]} />
  )
}
