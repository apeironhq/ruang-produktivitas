'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'

const TABS = [
  { href: '/keuangan', label: 'Ringkasan' },
  { href: '/keuangan/transaksi', label: 'Transaksi' },
  { href: '/keuangan/rekening', label: 'Rekening' },
  { href: '/keuangan/anggaran', label: 'Anggaran' },
]

/** Navigasi dalam modul Keuangan (pola DaftarHadiahTabs). Bulan yang dipilih ikut terbawa antar-tab. */
export function FinanceTabs() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const bulan = sp.get('bulan')
  return (
    <nav className="tabs" aria-label="Bagian Keuangan">
      {TABS.map((t) => {
        const on = pathname === t.href
        return (
          <Link key={t.href} prefetch href={bulan && t.href !== '/keuangan/rekening' ? `${t.href}?bulan=${bulan}` : t.href} className={`tab${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Pengalih bulan: ‹ November 2026 › */
export function MonthNav({ base, label, prev, next, isCurrent }: { base: string; label: string; prev: string; next: string; isCurrent: boolean }) {
  const sp = useSearchParams()
  const href = (bulan: string | null) => {
    const p = new URLSearchParams(sp.toString())
    if (bulan) p.set('bulan', bulan)
    else p.delete('bulan')
    p.delete('hal')
    const qs = p.toString()
    return qs ? `${base}?${qs}` : base
  }
  return (
    <div className="flex items-center gap-2">
      <Link href={href(prev)} className="btn btn-secondary btn-sm btn-icon" aria-label="Bulan sebelumnya" scroll={false}><ChevronLeft size={16} /></Link>
      <span className="text-label min-w-[8.5rem] text-center capitalize">{label}</span>
      <Link href={href(next)} className="btn btn-secondary btn-sm btn-icon" aria-label="Bulan berikutnya" scroll={false}><ChevronRight size={16} /></Link>
      {!isCurrent && <Link href={href(null)} className="btn btn-ghost btn-sm" scroll={false}>Bulan ini</Link>}
    </div>
  )
}
