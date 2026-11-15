import { DEFAULT_TZ } from './dates'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

export function formatNumber(value: number | string | null | undefined): string {
  return number.format(Number(value ?? 0))
}

export function formatRupiah(value: number | string | null | undefined): string {
  return rupiah.format(Number(value ?? 0)).replace(/ /g, '')
}

/** "YYYY-MM-DD" → "15 Nov 2026" (tanpa pergeseran zona). */
export function formatDay(day: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!day) return '—'
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { ...opts, timeZone: 'UTC' }).format(d)
}

export function formatDayLong(day: string): string {
  return formatDay(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d)
}

export function formatShort(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso))
}

export function formatTime(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso))
}

/** 95 → "1 j 35 m"; 40 → "40 m". */
export function formatDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutes ?? 0)))
  if (m < 60) return `${m} m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} j ${r} m` : `${h} j`
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'baru saja'
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`
  if (s < 172800) return 'kemarin'
  return formatDay(new Date(t).toISOString())
}

/**
 * Angka dari input pengguna dengan konvensi Indonesia:
 * "100.000.000" → 100000000, "12,5" → 12.5, "1.250,75" → 1250.75, "12.5" → 12.5.
 */
export function parseIdNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim().replace(/\s|rp/gi, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Nilai target sesuai satuannya. */
export function formatMetric(value: number | string | null | undefined, metric: string, unit = ''): string {
  const v = Number(value ?? 0)
  switch (metric) {
    case 'rupiah': return formatRupiah(v)
    case 'durasi': return formatDuration(v)
    case 'persentase': return `${formatNumber(v)}%`
    case 'biner': return v >= 1 ? 'Selesai' : 'Belum'
    default: return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v)
  }
}

export function progressPercent(current: number, start: number, target: number): number {
  if (target === start) return 0
  return Math.min(100, Math.max(0, Math.round(((current - start) / (target - start)) * 1000) / 10))
}
