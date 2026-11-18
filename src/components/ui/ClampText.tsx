'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Teks panjang (mis. deskripsi target / proyek / bidang belajar): tampil maks. `lines` baris,
 * dengan tombol "Selengkapnya" / "Ringkas" bila terpotong. Baris baru dari pengguna dipertahankan.
 */
export function ClampText({ text, lines = 3, className = '' }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])

  return (
    <div className={className}>
      <p ref={ref} className={`prose-plain desc-text${open ? '' : ' desc-clamp'}`} style={open ? undefined : { WebkitLineClamp: lines }}>{text}</p>
      {(over || open) && (
        <button type="button" className="link text-caption mt-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Ringkas' : 'Selengkapnya'}
        </button>
      )}
    </div>
  )
}
