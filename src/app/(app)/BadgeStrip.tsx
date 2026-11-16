'use client'

import { Award, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { tint } from '@/components/ui/display'

export interface StripBadge { id: string; name: string; description: string; earned: string; icon: React.ReactNode; color: string }

const MIN_W = 200 // lebar minimum satu kotak lencana
const GAP = 12

/**
 * Lencana terbaru, responsif: jumlah kotak mengikuti lebar kartu (satu baris di desktop, 2×2 di ponsel)
 * sehingga tidak ada ruang kosong. Bila tidak muat semua, kotak terakhir menjadi "+N lainnya".
 */
export function BadgeStrip({ badges }: { badges: StripBadge[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [cap, setCap] = useState({ cols: 5, slots: 5 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const mobile = w < 560
      const cols = mobile ? 2 : Math.max(2, Math.floor((w + GAP) / (MIN_W + GAP)))
      setCap({ cols, slots: mobile ? 4 : cols })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shown = badges.length > cap.slots ? cap.slots - 1 : badges.length
  const rest = badges.length - shown
  return (
    <div ref={ref} className="badge-strip" style={{ gridTemplateColumns: `repeat(${cap.cols}, minmax(0, 1fr))` }}>
      {badges.slice(0, shown).map((b) => (
        <Link key={b.id} href="/pencapaian" className="badge-chip" title={b.description}>
          <span className="badge-medal" style={tint(b.color)} aria-hidden="true">{b.icon}</span>
          <span className="min-w-0">
            <span className="badge-name line-clamp-2">{b.name}</span>
            <span className="item-sub block truncate">Diraih {b.earned}</span>
          </span>
        </Link>
      ))}
      {rest > 0 && (
        <Link href="/pencapaian" className="badge-chip">
          <span className="badge-medal" style={tint()} aria-hidden="true"><Award size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="badge-name">+{rest} lainnya</span>
            <span className="item-sub block">Lihat semua lencana</span>
          </span>
          <ChevronRight size={16} className="text-[var(--text-faint)] shrink-0" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}
