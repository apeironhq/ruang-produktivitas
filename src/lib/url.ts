/** Bangun href dengan query saat ini + perubahan (nilai kosong menghapus parameter). */
export function hrefWith(base: string, current: Record<string, string | string[] | undefined>, changes: Record<string, string | null>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) if (typeof v === 'string' && v) p.set(k, v)
  for (const [k, v] of Object.entries(changes)) {
    if (v) p.set(k, v)
    else p.delete(k)
  }
  p.delete('hal')
  const qs = p.toString()
  return qs ? `${base}?${qs}` : base
}

/** href halaman ke-n dengan saringan saat ini dipertahankan. */
export function pageHref(base: string, current: Record<string, string | string[] | undefined>, n: number) {
  const h = hrefWith(base, current, {})
  return n <= 1 ? h : `${h}${h.includes('?') ? '&' : '?'}hal=${n}`
}

export const str =(v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
