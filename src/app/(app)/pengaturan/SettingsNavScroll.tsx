'use client'

import { useEffect } from 'react'

/** Ponsel/tablet: menu bagian berupa pil yang bisa digeser — pastikan pil yang aktif terlihat. */
export function SettingsNavScroll({ active }: { active: string }) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.settings-nav')
    const el = nav?.querySelector<HTMLElement>('.settings-link.active')
    if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' })
  }, [active])
  return null
}
