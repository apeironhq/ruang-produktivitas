'use client'

import { SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

/** Parameter URL yang dianggap "saringan" (bukan pencarian / tab / halaman). */
const FILTER_KEYS = ['jenis', 'prioritas', 'rekening', 'kategori', 'periode', 'tag']

/**
 * Baris saringan kartu daftar. Di layar lebar semua tampil berderet.
 * Di ponsel hanya kotak cari + tombol "Saring"; pilihan lain muncul saat tombol ditekan
 * (otomatis terbuka bila ada saringan yang sedang aktif).
 */
export function FilterBar({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const active = FILTER_KEYS.filter((k) => sp.get(k)).length
  const [open, setOpen] = useState(active > 0)
  return (
    <div className={`card-filters filter-bar${open ? ' open' : ''}`}>
      {children}
      <button type="button" className="btn btn-secondary filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={16} aria-hidden="true" />Saring{active > 0 && <span className="filter-count">{active}</span>}
      </button>
    </div>
  )
}
