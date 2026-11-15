// Utilitas tanggal berbasis zona waktu pengguna (bawaan Asia/Jakarta).
// Kolom `date` disimpan apa adanya (YYYY-MM-DD); kolom `timestamptz` dikonversi dari/ke zona pengguna.

export const DEFAULT_TZ = 'Asia/Jakarta'

function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(date)) o[p.type] = p.value
  return { y: +o.year!, mo: +o.month!, d: +o.day!, h: +o.hour!, mi: +o.minute!, s: +o.second! }
}

/** Selisih (ms) waktu dinding zona `tz` terhadap UTC pada saat `date`. */
function offsetMs(date: Date, tz: string) {
  const p = partsIn(date, tz)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" hari ini di zona pengguna. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  const p = partsIn(now, tz)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`
}

/** Waktu dinding lokal ("YYYY-MM-DDTHH:mm" atau "YYYY-MM-DD") di zona `tz` → ISO UTC. */
export function zonedToIso(local: string, tz = DEFAULT_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim())
  if (!m) return null
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0))
  let ts = guess - offsetMs(new Date(guess), tz)
  ts = guess - offsetMs(new Date(ts), tz) // koreksi di sekitar pergantian DST
  return new Date(ts).toISOString()
}

/** ISO UTC → nilai input datetime-local di zona `tz`. */
export function isoToLocalInput(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = partsIn(d, tz)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}

/** ISO UTC → "YYYY-MM-DD" di zona `tz`. */
export function isoToDay(iso: string, tz = DEFAULT_TZ): string {
  const p = partsIn(new Date(iso), tz)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`
}

/** Tambah n hari ke "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Daftar hari (inklusif) dari `from` sampai `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Batas awal hari `day` (00:00 zona `tz`) dalam ISO UTC. */
export function startOfDayIso(day: string, tz = DEFAULT_TZ): string {
  return zonedToIso(day, tz)!
}

/** Hari dalam minggu (0 = Senin ... 6 = Minggu) untuk "YYYY-MM-DD". */
export function weekdayMon0(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
