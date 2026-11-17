'use client'

import { useEffect, useRef } from 'react'

/**
 * Di layar sempit panel hari ada di bawah kalender: saat pengguna memilih tanggal lain,
 * gulir halus ke panel agar agendanya langsung terlihat. Tidak berjalan saat halaman pertama dibuka.
 */
export function DayFocus({ sel, target }: { sel: string; target: string }) {
  const prev = useRef(sel)
  useEffect(() => {
    if (prev.current === sel) return
    prev.current = sel
    if (window.innerWidth >= 1200) return
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sel, target])
  return null
}
