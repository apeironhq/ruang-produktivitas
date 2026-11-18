import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/*
 * Endpoint AI kustom (API kompatibel OpenAI, mis. 9router) dipanggil dari server kita,
 * jadi alamatnya wajib HTTPS publik: tidak boleh localhost, jaringan privat, atau alamat
 * metadata cloud — agar fitur ini tidak bisa dipakai untuk menjangkau jaringan internal.
 */

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
}

function ipBlocked(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Blocked(ip)
  const v6 = ip.toLowerCase()
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return ipv4Blocked(mapped[1])
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6)
}

/** Rapikan alamat dasar: HTTPS, tanpa kredensial / query / fragmen, tanpa garis miring di akhir. */
export function normalizeBaseUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL
  try { u = new URL(input.trim()) } catch { return { ok: false, error: 'Alamat tidak valid. Contoh: https://nama-anda.vercel.app/v1' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'Alamat harus diawali https://' }
  if (u.username || u.password) return { ok: false, error: 'Alamat tidak boleh memuat nama pengguna / kata sandi.' }
  if (u.search || u.hash) return { ok: false, error: 'Alamat tidak boleh memuat ? atau #.' }
  if (u.port && u.port !== '443') return { ok: false, error: 'Gunakan alamat HTTPS standar (tanpa port khusus).' }
  const path = u.pathname.replace(/\/+$/, '')
  const url = `https://${u.hostname}${path}`
  if (url.length > 300) return { ok: false, error: 'Alamat terlalu panjang.' }
  return { ok: true, url }
}

/** null = aman; selain itu pesan penolakan. Dicek saat menyimpan dan sebelum setiap panggilan. */
export async function publicEndpointError(baseUrl: string): Promise<string | null> {
  let host: string
  try { host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '') } catch { return 'Alamat endpoint tidak valid.' }
  if (BLOCKED_HOST.test(host) || (!host.includes('.') && !isIP(host))) return 'Alamat harus domain publik (bukan localhost / jaringan lokal).'
  if (isIP(host)) return ipBlocked(host) ? 'Alamat IP privat / lokal tidak diizinkan.' : null
  try {
    const addrs = await lookup(host, { all: true, verbatim: true })
    if (!addrs.length) return 'Domain endpoint tidak ditemukan.'
    if (addrs.some((a) => ipBlocked(a.address))) return 'Domain endpoint mengarah ke jaringan privat / lokal.'
    return null
  } catch {
    return 'Domain endpoint tidak ditemukan.'
  }
}
