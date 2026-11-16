import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { esc, type ButtonStyle, type Keyboard } from '../telegram'

export { esc }

/** Konteks satu percakapan: pengguna tertaut + chat-nya. Klien service role → SELALU filter user_id. */
export interface Ctx { db: SupabaseClient; chatId: number; userId: string; tz: string; name: string }

export const OPEN = ['belum', 'dikerjakan', 'tertunda']
const DEFAULT_SITE = 'https://ruang-produktivitas.vercel.app'

/** Alamat publik aplikasi (untuk tombol & banner). */
export const siteUrl = () => {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  if (env.startsWith('https://')) return env
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return prod ? `https://${prod}` : DEFAULT_SITE
}

/* ---------- Teks ---------- */
/** Potong judul agar baris tetap ringkas di layar HP. */
export const cut = (s: string, n = 60) => esc(s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
export const bar = (pct: number) => {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '▰'.repeat(n) + '▱'.repeat(10 - n)
}

/**
 * Panel = isi satu pesan bot: judul, beberapa bagian (blockquote Telegram), kaki, dan tombol.
 * Bagian berbingkai (quote) membuat pesan teks tetap rapi; 'expand' = kutipan yang bisa dibuka-tutup.
 */
export interface Section { title?: string; lines: string[]; quote?: boolean | 'expand' }
export interface Panel { head: string[]; sections: Section[]; foot?: string[]; kb: Keyboard }

/** Judul bagian di luar kutipan (seperti judul kartu), isinya di dalam kutipan bila quote. */
function sectionHtml(s: Section, hidden: number) {
  const title = s.title ? `<b>${s.title}</b>\n` : ''
  const body = [...s.lines, ...(hidden ? [`<i>+${hidden} lainnya</i>`] : [])].join('\n')
  if (!s.quote) return `${title}${body}`
  return `${title}<blockquote${s.quote === 'expand' ? ' expandable' : ''}>${body}</blockquote>`
}

/** Susun HTML panel; bila melebihi batas (keterangan foto 1024), kurangi baris dari bagian terpanjang. */
export function renderPanel(p: Panel, max = 4000): string {
  const secs = p.sections.map((s) => ({ ...s, lines: [...s.lines], hidden: 0 }))
  const build = () => [
    p.head.join('\n'),
    ...secs.filter((s) => s.lines.length || s.title).map((s) => sectionHtml(s, s.hidden)),
    ...(p.foot?.length ? [p.foot.join('\n')] : []),
  ].filter(Boolean).join('\n\n')
  let html = build()
  while (html.length > max) {
    const s = secs.filter((x) => x.lines.length > 1).sort((a, b) => b.lines.length - a.lines.length)[0]
    if (!s) break
    s.lines.pop()
    s.hidden++
    html = build()
  }
  return html.length > max ? html.slice(0, max) : html
}

/* ---------- Tombol ---------- */
export const btn = (text: string, data: string, style?: ButtonStyle) => ({ text, callback_data: data, ...(style ? { style } : {}) })
export const link = (text: string, path = '/', style?: ButtonStyle) => ({ text, url: `${siteUrl()}${path}`, ...(style ? { style } : {}) })
export function rows<T>(items: T[], per: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per))
  return out
}
/** Baris navigasi bawah: kembali (ke panel induk) + buka halaman web terkait. */
export function navRow(back = 'p:home', webPath?: string, backLabel = '⬅️ Menu') {
  return [btn(backLabel, back), ...(webPath ? [link('🌐 Buka di web', webPath)] : [])]
}

export const MAIN_MENU: Keyboard = [
  [btn('📝 Catat Cepat', 'p:catat'), btn('✅ Tugas', 'p:tugas')],
  [btn('📅 Kalender', 'p:kal'), btn('📁 Proyek', 'p:proyek')],
  [btn('🎯 Target', 'p:target'), btn('💰 Keuangan', 'p:uang')],
  [btn('📚 Belajar', 'p:belajar'), btn('🗒 Jurnal', 'p:jurnal')],
  [btn('🔁 Kebiasaan', 'p:habit'), btn('🏆 Pencapaian', 'p:lencana')],
  [btn('📊 Ringkasan', 'p:ringkas'), btn('⚙️ Pengaturan', 'p:atur')],
]
export const mainKeyboard = (): Keyboard => [...MAIN_MENU, [link('🌐 Buka Ruang Produktivitas', '/', 'primary')]]

/* ---------- Waktu ---------- */
export function greetingFor(tz: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
}
/** "Senin, 16 November 2026" dari "YYYY-MM-DD". */
export const longDay = (day: string) =>
  new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
/** "Sen, 16 Nov" dari "YYYY-MM-DD". */
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
export const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
