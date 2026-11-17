'use client'

import { ChevronDown } from 'lucide-react'
import { Children, useState } from 'react'

/**
 * Daftar yang di ponsel hanya menampilkan 5 item pertama (aturan CSS .limit-list), sisanya lewat tombol "Tampilkan lainnya".
 * Di layar lebar semua item tampil (panelnya sudah bisa digulir), jadi tombolnya disembunyikan lewat CSS.
 */
export function LimitList({ className = 'items', children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const count = Children.count(children)
  const hidden = count - 5
  return (
    <>
      <ul className={`${className} limit-list${open ? ' open' : ''}`}>{children}</ul>
      {hidden > 0 && !open && (
        <button type="button" className="limit-more" onClick={() => setOpen(true)}>
          <ChevronDown size={15} aria-hidden="true" />Tampilkan {hidden} lainnya
        </button>
      )}
    </>
  )
}
