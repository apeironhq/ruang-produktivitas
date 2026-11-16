import { addDays, weekdayMon0 } from './dates'

/** Statistik satu kebiasaan dari tanggal check-in ("YYYY-MM-DD"), dihitung relatif ke hari ini (zona pengguna). */
export function habitStats(dates: string[], today: string) {
  const set = new Set(dates)
  // Streak berjalan: berakhir hari ini, atau kemarin bila hari ini belum check-in (masih bisa dilanjutkan).
  let current = 0
  let d = set.has(today) ? today : addDays(today, -1)
  while (set.has(d)) { current++; d = addDays(d, -1) }
  // Streak terbaik
  const sorted = [...set].sort()
  let best = 0, run = 0, prev = ''
  for (const x of sorted) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x }
  const weekStart = addDays(today, -weekdayMon0(today))
  const thisWeek = sorted.filter((x) => x >= weekStart && x <= today).length
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((day) => ({ day, done: set.has(day) }))
  return { doneToday: set.has(today), current, best, thisWeek, total: set.size, last7 }
}

export const DOW_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
