'use client'

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/**
 * Judul kalender yang bisa diklik untuk langsung lompat ke bulan & tahun mana pun.
 * `month` = bulan yang sedang tampil (YYYY-MM), `today` = YYYY-MM-DD, `week` = sedang di tampilan Minggu.
 */
export function MonthPicker({ label, month, today, week }: { label: string; month: string; today: string; week: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (m: number) => {
    const ym = `${year}-${String(m + 1).padStart(2, '0')}`
    setOpen(false)
    const day = ym === today.slice(0, 7) ? today : `${ym}-01`
    router.push(week ? `/kalender?tampilan=minggu&tgl=${day}` : `/kalender?bulan=${ym}`, { scroll: false })
  }

  return (
    <div className="mp" ref={box}>
      <button type="button" className="mp-trigger" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setYear(Number(month.slice(0, 4))); setOpen((o) => !o) }}>
        <CalendarDays size={18} aria-hidden="true" />
        <span className="capitalize">{label}</span>
        <ChevronDown size={16} className="mp-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="mp-pop" role="dialog" aria-label="Pilih bulan dan tahun">
          <div className="mp-year">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Tahun sebelumnya" onClick={() => setYear((y) => y - 1)}><ChevronLeft size={16} /></button>
            <span>{year}</span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Tahun berikutnya" onClick={() => setYear((y) => y + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="mp-grid">
            {MONTHS.map((m, i) => {
              const ym = `${year}-${String(i + 1).padStart(2, '0')}`
              const cls = ['mp-month', ym === month ? 'on' : '', ym === today.slice(0, 7) ? 'now' : ''].filter(Boolean).join(' ')
              return <button key={m} type="button" className={cls} aria-pressed={ym === month} onClick={() => go(i)}>{m}</button>
            })}
          </div>
        </div>
      )}
    </div>
  )
}
