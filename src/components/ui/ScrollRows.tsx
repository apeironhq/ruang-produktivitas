'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Grid yang hanya menampilkan `rows` baris pertama; sisanya digulir ke bawah di dalam kartu.
 * Tinggi dihitung dari posisi kotak pertama di baris berikutnya, jadi tetap pas di semua lebar layar
 * (jumlah kolom berubah) dan tinggi kotak yang berbeda-beda.
 */
export function ScrollRows({ rows = 2, className = '', children }: { rows?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [max, setMax] = useState<number | null>(null)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const items = [...el.children] as HTMLElement[]
      const tops = [...new Set(items.map((c) => c.offsetTop))].sort((a, b) => a - b)
      if (tops.length <= rows) { setMax(null); return }
      // Batas = awal baris ke-(rows+1) dikurangi jarak antarbaris, ditambah sedikit intip agar terlihat bisa digulir.
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0
      setMax(tops[rows]! - tops[0]! - gap + 28)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows])

  const scrollable = max !== null
  return (
    <div className={`scroll-rows${scrollable ? ' is-scroll' : ''}${atEnd ? ' at-end' : ''}`}>
      <div ref={ref} className={className} tabIndex={scrollable ? 0 : undefined} aria-label={scrollable ? 'Daftar dapat digulir' : undefined}
        style={scrollable ? { maxHeight: max, overflowY: 'auto' } : undefined}
        onScroll={(e) => { const t = e.currentTarget; setAtEnd(t.scrollTop + t.clientHeight >= t.scrollHeight - 4) }}>
        {children}
      </div>
      {/* Tetap dirender (hanya disembunyikan) di ujung daftar agar tinggi kotak tidak berubah dan halaman tidak meloncat. */}
      {scrollable && <p className="scroll-rows-hint" aria-hidden={atEnd} style={atEnd ? { visibility: 'hidden' } : undefined}><ChevronDown size={14} aria-hidden="true" />Gulir untuk melihat lainnya</p>}
    </div>
  )
}
