import { addDays, isoToDay, todayIn, weekdayMon0, zonedToIso } from '../dates'
import { formatTime } from '../format'

/*
 * Pembaca waktu bahasa sehari-hari untuk bot Rupi.
 * Contoh yang dikenali: "besok jam 14", "jam 4 sore", "nanti malam", "besok pagi", "jumat 10.00",
 * "senin depan jam 9", "20 nov", "tgl 25", "20/11 14.30", "2 jam lagi", "3 hari lagi", "setengah 8 malam".
 * Kata-kata waktu dibuang dari teks; sisanya (`rest`) dipakai sebagai judul/pesan.
 */

export interface When {
  iso: string
  /** teks tanpa kata-kata waktu */
  rest: string
  /** tanggal disebut eksplisit (besok, jumat, 20/11, ...) */
  hasDay: boolean
  /** jam disebut (jam 9, 14.30, sore, 2 jam lagi, ...) */
  hasTime: boolean
}

const DAYS: Record<string, number> = { senin: 0, selasa: 1, rabu: 2, kamis: 3, jumat: 4, "jum'at": 4, sabtu: 5, minggu: 6, ahad: 6 }
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, peb: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, nop: 11, november: 11, des: 12, desember: 12,
}
const PARTS: Record<string, [number, number]> = { subuh: [5, 0], pagi: [8, 0], siang: [12, 0], sore: [16, 0], petang: [18, 0], malam: [19, 0] }
const NUM_WORDS: Record<string, number> = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11 }
const TOMORROW = new Set(['besok', 'bsk', 'besuk', 'esok'])
const LATER = new Set(['nanti', 'ntar', 'nnti', 'entar'])
const CLOCK_WORDS = new Set(['jam', 'pukul', 'pkl', 'pk', 'jm'])
const pad = (n: number) => String(n).padStart(2, '0')

type Clock = { h: number; m: number; fixed: boolean }

function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d!, last))}`
}
function validDay(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
/** Jam dengan keterangan bagian hari: "4 sore" → 16, "2 siang" → 14, "8 malam" → 20, "12 malam" → 23.59. */
function withPart(h: number, m: number, part: string): [number, number] {
  if (part === 'subuh' || part === 'pagi') return [h === 12 ? 0 : h, m]
  if (part === 'siang') return [h >= 1 && h <= 5 ? h + 12 : h, m]
  if (part === 'sore' || part === 'petang') return [h < 12 ? h + 12 : h, m]
  if (part === 'malam') return h === 12 ? [23, 59] : [h >= 6 && h < 12 ? h + 12 : h, m]
  return [h, m]
}

export function extractWhen(text: string, tz: string, opts: { defaultTime?: string; future?: boolean; now?: Date; part?: string; timeOnly?: boolean } = {}): When | null {
  const now = opts.now ?? new Date()
  const today = todayIn(tz, now)
  const raw = text.trim().split(/\s+/).filter(Boolean)
  const low = raw.map((w) => w.toLowerCase().replace(/^[("'“‘]+/, '').replace(/[)"'”’,!?;]+$/, '').replace(/\.+$/, ''))
  const used = raw.map(() => false)
  const mark = (i: number, k: number) => { for (let j = i; j < i + k && j < used.length; j++) used[j] = true }
  const num = (w: string | undefined, max: number): number | null => {
    if (!w) return null
    const n = /^\d{1,2}$/.test(w) ? Number(w) : NUM_WORDS[w] ?? null
    return n !== null && n >= 0 && n <= max ? n : null
  }

  let day: string | null = null
  let clock: Clock | null = null
  let part: string | null = null
  let relMs: number | null = null

  // "9", "14.30", "setengah 8", "dua belas" di posisi j
  const readClock = (j: number): (Clock & { len: number }) | null => {
    const w = low[j]
    if (!w) return null
    if (w === 'setengah') { const n = num(low[j + 1], 12); return n ? { h: n - 1, m: 30, len: 2, fixed: false } : null }
    const hm = /^(\d{1,2})[.:](\d{2})$/.exec(w)
    if (hm) {
      const h = +hm[1]!, m = +hm[2]!
      return h <= 23 && m <= 59 ? { h, m, len: 1, fixed: hm[1]!.startsWith('0') || h >= 13 } : null
    }
    if (w === 'dua' && low[j + 1] === 'belas') return { h: 12, m: 0, len: 2, fixed: false }
    const n = num(w, 24)
    if (n === null) return null
    return { h: n === 24 ? 0 : n, m: 0, len: 1, fixed: /^0\d$/.test(w) || n >= 13 }
  }
  /** Ambil jam mulai `start + skip`, beserta "pagi/sore/…" dan "wib" sesudahnya. */
  const takeClock = (start: number, skip: number, needPart = false): boolean => {
    const c = readClock(start + skip)
    if (!c) return false
    let k = skip + c.len
    const p = low[start + k]
    const hasPart = !!(p && PARTS[p])
    if (needPart && !hasPart) return false
    if (hasPart) { part = p!; k++ }
    if (low[start + k] === 'wib') k++
    clock = { h: c.h, m: c.m, fixed: c.fixed }
    mark(start, k)
    return true
  }
  const weekday = (target: number, mode: 'ini' | 'depan' | null) => {
    let diff = (target - weekdayMon0(today) + 7) % 7
    if (diff === 0 && mode !== 'ini') diff = 7
    return addDays(today, diff)
  }
  const lagi = (x?: string) => x === 'lagi' || x === 'kemudian'

  for (let i = 0; i < low.length; i++) {
    if (used[i]) continue
    const w = low[i]!, w1 = low[i + 1], w2 = low[i + 2]

    // `timeOnly` (pengingat berulang): harinya sudah dari pola, jadi hanya baca jam — "sholat jumat" tetap utuh.
    if (opts.timeOnly) {
      if (CLOCK_WORDS.has(w) && takeClock(i, 1)) continue
      if (/^\d{1,2}[.:]\d{2}$/.test(w) && takeClock(i, 0)) continue
      if ((num(w, 12) !== null || w === 'setengah') && takeClock(i, 0, true)) continue
      continue
    }

    // relatif: "2 jam lagi", "30 menit lagi", "3 hari lagi", "2 minggu lagi", "sejam lagi", "setengah jam lagi"
    if (w === 'sejam' && lagi(w1)) { relMs = 3_600_000; mark(i, 2); continue }
    if (w === 'setengah' && w1 === 'jam' && lagi(w2)) { relMs = 1_800_000; mark(i, 3); continue }
    const n = /^\d{1,3}$/.test(w) ? Number(w) : NUM_WORDS[w] ?? null
    if (n !== null && n > 0 && w1 && lagi(w2)) {
      if (['menit', 'mnt', 'm'].includes(w1)) { relMs = n * 60_000; mark(i, 3); continue }
      if (['jam', 'j'].includes(w1)) { relMs = n * 3_600_000; mark(i, 3); continue }
      if (w1 === 'hari') { day = addDays(today, n); mark(i, 3); continue }
      if (w1 === 'minggu' || w1 === 'pekan') { day = addDays(today, n * 7); mark(i, 3); continue }
      if (w1 === 'bulan') { day = addMonths(today, n); mark(i, 3); continue }
    }
    // "hari ini", "hari jumat"
    if (w === 'hari' && w1 === 'ini') { day = today; mark(i, 2); continue }
    if (w === 'hari' && w1 && DAYS[w1] !== undefined) { mark(i, 1); continue } // nama harinya diproses di putaran berikut
    // "malam ini", "sore ini"
    if (PARTS[w] && w1 === 'ini') { day = today; part = w; mark(i, 2); continue }
    if (TOMORROW.has(w)) { day = addDays(today, 1); mark(i, 1); continue }
    if (w === 'lusa') { day = addDays(today, 2); mark(i, 1); continue }
    if (LATER.has(w) && w1 && (PARTS[w1] || CLOCK_WORDS.has(w1) || /^\d{1,2}[.:]\d{2}$/.test(w1))) { day ??= today; mark(i, 1); continue }
    if ((w === 'minggu' || w === 'pekan') && w1 === 'depan') { day = addDays(today, 7); mark(i, 2); continue }
    if (DAYS[w] !== undefined) {
      const mode = w1 === 'ini' ? 'ini' : w1 === 'depan' ? 'depan' : null
      day = weekday(DAYS[w]!, mode); mark(i, mode ? 2 : 1); continue
    }
    // "tgl 25", "tanggal 3 des"
    if ((w === 'tgl' || w === 'tanggal') && num(w1, 31)) {
      const d = num(w1, 31)!, mo = w2 ? MONTHS[w2] : undefined
      const [y, m] = today.split('-').map(Number) as [number, number]
      let v = validDay(y, mo ?? m, d)
      if (v && v < today) v = mo ? validDay(y + 1, mo, d) : m === 12 ? validDay(y + 1, 1, d) : validDay(y, m + 1, d)
      if (v) { day = v; mark(i, mo ? 3 : 2); continue }
    }
    // "20 nov", "3 desember 2026"
    if (num(w, 31) && w1 && MONTHS[w1]) {
      const yr = w2 && /^\d{4}$/.test(w2) ? Number(w2) : null
      const y = yr ?? Number(today.slice(0, 4))
      let v = validDay(y, MONTHS[w1]!, num(w, 31)!)
      if (v && !yr && v < today) v = validDay(y + 1, MONTHS[w1]!, num(w, 31)!)
      if (v) { day = v; mark(i, yr ? 3 : 2); continue }
    }
    // "2026-11-20", "20/11", "20-11-2026"
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w)
    if (iso) { const v = validDay(+iso[1]!, +iso[2]!, +iso[3]!); if (v) { day = v; mark(i, 1); continue } }
    const dm = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(w)
    if (dm) {
      const y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4))
      let v = validDay(y, +dm[2]!, +dm[1]!)
      if (v && !dm[3] && v < today) v = validDay(y + 1, +dm[2]!, +dm[1]!)
      if (v) { day = v; mark(i, 1); continue }
    }
    // "jam 9", "pukul 14.30 wib", "jam 4 sore"
    if (CLOCK_WORDS.has(w) && takeClock(i, 1)) continue
    // "14.30", "9.00 malam"
    if (/^\d{1,2}[.:]\d{2}$/.test(w) && takeClock(i, 0)) continue
    // "4 sore", "setengah 8 malam", "tujuh pagi"
    if ((num(w, 12) !== null || w === 'setengah') && takeClock(i, 0, true)) continue
    // "besok pagi", "jumat malam" — bagian hari tepat setelah kata waktu lain
    if (PARTS[w] && i > 0 && used[i - 1] && !part) { part = w; mark(i, 1); continue }
  }

  // kata sambung yang menempel pada kata waktu
  for (let i = 0; i < low.length; i++) {
    if (!used[i] && ['pada', 'tgl', 'tanggal', 'wib', 'pkl'].includes(low[i]!) && (used[i + 1] || used[i - 1])) used[i] = true
  }

  const c = clock as Clock | null
  // `opts.part`: bagian hari dari luar (mis. "tiap malam") bila teks tidak menyebutnya sendiri
  const p = (part as string | null) ?? (opts.part && PARTS[opts.part] ? opts.part : null)
  const hasTime = relMs !== null || c !== null || p !== null
  if (!day && !hasTime) return null

  let isoOut: string | null
  if (relMs !== null) {
    isoOut = new Date(now.getTime() + relMs).toISOString()
  } else {
    let h: number, m: number
    let ambiguous = false
    if (c) {
      ;[h, m] = p ? withPart(c.h, c.m, p) : [c.h, c.m]
      // "jam 2" tanpa pagi/sore → hampir selalu siang hari (14.00)
      if (!p && !c.fixed && h >= 1 && h <= 5) h += 12
      ambiguous = !p && !c.fixed && h < 12
    } else if (p) {
      ;[h, m] = PARTS[p]!
    } else {
      const [dh, dmin] = (opts.defaultTime ?? '09:00').split(':').map(Number)
      h = dh!; m = dmin!
    }
    let d = day ?? today
    isoOut = zonedToIso(`${d}T${pad(h)}:${pad(m)}`, tz)
    // Pengingat harus di masa depan: tanpa tanggal eksplisit, "jam 9" yang sudah lewat → 21.00 atau besok.
    if (opts.future && !day && isoOut && new Date(isoOut).getTime() <= now.getTime()) {
      const pm = ambiguous ? zonedToIso(`${d}T${pad(h + 12)}:${pad(m)}`, tz) : null
      if (pm && new Date(pm).getTime() > now.getTime()) isoOut = pm
      else { d = addDays(d, 1); isoOut = zonedToIso(`${d}T${pad(h)}:${pad(m)}`, tz) }
    }
  }
  if (!isoOut) return null

  const rest = raw.filter((_, i) => !used[i]).join(' ')
    .replace(/\s+([,.!?])/g, '$1').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim()
  return { iso: isoOut, rest, hasDay: day !== null, hasTime }
}

/** Teks waktu → ISO, atau null. */
export function parseWhen(text: string, tz: string, defaultTime = '09:00', future = false): string | null {
  return extractWhen(text, tz, { defaultTime, future })?.iso ?? null
}

/** Rapikan pesan pengingat: "aku untuk bayar listrik ya" → "bayar listrik". */
export function cleanReminderLabel(s: string): string {
  let t = s.trim()
  for (let k = 0; k < 4; k++) t = t.replace(/^(aku|saya|gue|gw|ku|untuk|utk|buat|biar|supaya|agar|tentang|soal|kalau|kalo|bahwa|harus|mesti)\b[\s,]*/i, '')
  t = t.replace(/[\s,]+(ya|yah|dong|ok|oke|nanti)$/i, '')
  return t.trim()
}

const WD = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "Hari ini 14.00", "Besok 08.00", "Lusa 09.00", "Jum, 21 Nov 14.00". `bare`: hari ini cukup jamnya. */
export function whenLabel(iso: string, tz: string, opts: { bare?: boolean; now?: Date } = {}): string {
  const today = todayIn(tz, opts.now ?? new Date())
  const day = isoToDay(iso, tz)
  const time = formatTime(iso, tz)
  if (day === today) return opts.bare ? time : `Hari ini ${time}`
  if (day === addDays(today, 1)) return `Besok ${time}`
  if (day === addDays(today, 2)) return `Lusa ${time}`
  const [y, m, d] = day.split('-').map(Number)
  return `${WD[weekdayMon0(day)]}, ${d} ${MON[m! - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''} ${time}`
}

/** 5 → "5 menit", 90 → "1 jam 30 menit", 120 → "2 jam". */
export function minutesLabel(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutes ?? 0)))
  if (m < 60) return `${m} menit`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} jam ${r} menit` : `${h} jam`
}

/* ---------- Tebakan kategori transaksi dari keterangan ---------- */
const CATEGORY_HINTS: Array<[RegExp, string[]]> = [
  [/\b(makan|minum|kopi|sarapan|nasi|bakso|mie|ayam|jajan|snack|cemilan|teh|gofood|grabfood|shopeefood|warung|resto|restoran|cafe|kafe|sate|martabak|roti|susu|galon|lauk|sayur)\b/i, ['makan']],
  [/\b(bensin|pertalite|pertamax|solar|parkir|ojek|ojol|gojek|grab|maxim|tol|angkot|kereta|krl|mrt|lrt|transjakarta|bus|taksi|travel|tiket|servis|cuci motor|cuci mobil)\b/i, ['transport']],
  [/\b(listrik|pln|pdam|wifi|internet|pulsa|kuota|token|indihome|bpjs|cicilan|sewa|kos|kost|kontrakan|iuran|tagihan|asuransi)\b/i, ['tagihan', 'utilitas']],
  [/\b(obat|dokter|apotek|apotik|klinik|vitamin|periksa|puskesmas)\b/i, ['kesehatan']],
  [/\b(buku|kursus|kuliah|spp|sekolah|les|ujian|kelas|seminar|pelatihan|ukt)\b/i, ['pendidikan']],
  [/\b(nonton|bioskop|netflix|spotify|game|langganan|liburan|wisata|konser|hiburan)\b/i, ['hiburan']],
  [/\b(sedekah|infak|infaq|zakat|donasi|sumbangan|amal|wakaf)\b/i, ['sedekah', 'donasi']],
  [/\b(belanja|baju|celana|sepatu|tas|shopee|tokopedia|lazada|indomaret|alfamart|sabun|sampo|skincare|perabot)\b/i, ['belanja']],
  [/\b(gaji|salary|upah)\b/i, ['gaji']],
  [/\b(bonus|thr|insentif)\b/i, ['bonus', 'gaji']],
  [/\b(freelance|proyek|project|honor|fee|jasa|klien)\b/i, ['freelance', 'proyek', 'usaha']],
  [/\b(jual|jualan|penjualan|dagang|usaha|omzet)\b/i, ['usaha', 'penjualan', 'jual']],
]
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Cari kategori yang cocok dengan keterangan, mis. "makan siang" → "Makan & minum". */
export function guessCategory<T extends { id: string; name: string }>(note: string, cats: T[]): T | null {
  const text = note.toLowerCase()
  if (!text.trim()) return null
  // 1) nama kategori (kata pertamanya) disebut langsung, mis. "gaji november" → "Gaji"
  const direct = cats.find((c) => {
    const key = c.name.toLowerCase().split(/\s*[&,]\s*|\s+/)[0] ?? ''
    return key.length >= 4 && key !== 'lainnya' && new RegExp(`\\b${escRe(key)}\\b`).test(text)
  })
  if (direct) return direct
  // 2) kata kunci umum → kategori yang namanya memuat petunjuk
  for (const [re, hints] of CATEGORY_HINTS) {
    if (!re.test(text)) continue
    const c = cats.find((x) => hints.some((h) => x.name.toLowerCase().includes(h)))
    if (c) return c
  }
  return null
}

/* ---------- Pengingat berulang: "tiap hari", "tiap senin & kamis", "tiap hari kerja", "tiap malam" ---------- */
const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const JOIN = new Set(['dan', '&', ',', 'serta'])
const RANGE = new Set(['sampai', 's/d', 'sd', 'hingga', '-'])

/** Jam-menit "HH:MM" dari ISO di zona `tz`. */
export function hhmmIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

/** Hari yang diizinkan pola (0 = Senin … 6 = Minggu). */
export function repeatDays(repeat: string): number[] {
  if (repeat === 'harian') return [0, 1, 2, 3, 4, 5, 6]
  if (repeat === 'kerja') return [0, 1, 2, 3, 4]
  const m = /^mingguan:([0-6](?:,[0-6])*)$/.exec(repeat)
  return m ? [...new Set(m[1]!.split(',').map(Number))].sort() : []
}

/** "Tiap hari", "Tiap hari kerja", "Tiap akhir pekan", "Tiap Senin & Kamis". */
export function repeatLabel(repeat: string): string {
  if (repeat === 'harian') return 'Tiap hari'
  if (repeat === 'kerja') return 'Tiap hari kerja'
  const days = repeatDays(repeat)
  if (days.join() === '5,6') return 'Tiap akhir pekan'
  const names = days.map((d) => DAY_NAMES[d]!)
  return `Tiap ${names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0] ?? ''}`
}

/** Kejadian berikutnya pola `repeat` pada jam `hhmm` (zona `tz`) yang jatuh setelah `after`. */
export function nextOccurrence(repeat: string, hhmm: string, tz: string, after: Date): string | null {
  const allowed = new Set(repeatDays(repeat))
  if (!allowed.size) return null
  const start = todayIn(tz, after)
  for (let d = 0; d <= 8; d++) {
    const day = addDays(start, d)
    if (!allowed.has(weekdayMon0(day))) continue
    const iso = zonedToIso(`${day}T${hhmm}`, tz)
    if (iso && new Date(iso).getTime() > after.getTime()) return iso
  }
  return null
}

/**
 * Cari pola pengulangan yang diawali "tiap"/"setiap"/"saban". Kata polanya dibuang dari teks.
 * `part` diisi bila polanya bagian hari ("tiap malam" → harian, malam).
 */
export function extractRepeat(text: string, tz: string, now = new Date()): { repeat: string; rest: string; part: string | null } | null {
  const raw = text.trim().split(/\s+/).filter(Boolean)
  const low = raw.map((w) => w.toLowerCase().replace(/[,.!?;]+$/, ''))
  const i = low.findIndex((w) => w === 'tiap' || w === 'setiap' || w === 'saban')
  if (i < 0) return null
  const w1 = low[i + 1], w2 = low[i + 2]
  let repeat: string | null = null, part: string | null = null, end = i + 1
  const daysToRepeat = (set: Set<number>) => set.size === 7 ? 'harian' : [...set].sort().join() === '0,1,2,3,4' ? 'kerja' : `mingguan:${[...set].sort().join(',')}`

  if (w1 === 'hari' && w2 === 'kerja') { repeat = 'kerja'; end = i + 3 }
  else if (w1 === 'akhir' && (w2 === 'pekan' || w2 === 'minggu')) { repeat = 'mingguan:5,6'; end = i + 3 }
  else if (w1 === 'weekend') { repeat = 'mingguan:5,6'; end = i + 2 }
  else if (w1 && PARTS[w1]) { repeat = 'harian'; part = w1; end = i + 2 }
  else if ((w1 === 'minggu' || w1 === 'pekan') && !(w2 && (JOIN.has(w2) || RANGE.has(w2) || DAYS[w2] !== undefined))) {
    // "tiap minggu" = seminggu sekali, pada hari yang sama dengan hari ini
    repeat = `mingguan:${weekdayMon0(todayIn(tz, now))}`; end = i + 2
  } else {
    // daftar hari: "senin", "hari senin", "senin dan kamis", "senin, rabu, jumat", "senin-jumat", "senin sampai jumat"
    let j = i + 1
    if (low[j] === 'hari' && low[j + 1] && (DAYS[low[j + 1]!] !== undefined || /-/.test(low[j + 1]!))) j++
    const days = new Set<number>()
    let last: number | null = null, range = false, lastIdx = -1
    const addRange = (a: number, b: number) => { for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break } }
    while (j < low.length) {
      const t = low[j]!
      const rng = /^([a-z']+)-([a-z']+)$/.exec(t)
      if (rng && DAYS[rng[1]!] !== undefined && DAYS[rng[2]!] !== undefined) { addRange(DAYS[rng[1]!]!, DAYS[rng[2]!]!); last = DAYS[rng[2]!]!; lastIdx = j; j++; continue }
      if (DAYS[t] !== undefined) {
        if (range && last !== null) addRange(last, DAYS[t]!); else days.add(DAYS[t]!)
        last = DAYS[t]!; range = false; lastIdx = j; j++; continue
      }
      if (last !== null && JOIN.has(t)) { j++; continue }
      if (last !== null && RANGE.has(t)) { range = true; j++; continue }
      break
    }
    if (days.size) { repeat = daysToRepeat(days); end = lastIdx + 1 }
    else if (w1 === 'hari') { repeat = 'harian'; end = i + 2 }
    else if (w1 === 'harinya') { repeat = 'harian'; end = i + 2 }
  }
  if (!repeat) return null
  // "tiap senin pagi" → bagian hari tepat setelah pola
  if (!part && low[end] && PARTS[low[end]!]) { part = low[end]!; end++ }
  const rest = [...raw.slice(0, i), ...raw.slice(end)].join(' ').replace(/\s+/g, ' ').trim()
  return { repeat, rest, part }
}
