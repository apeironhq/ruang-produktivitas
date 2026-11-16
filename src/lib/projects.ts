/** Progres proyek: dari tugas tertaut (dibatalkan tidak dihitung) bila ada, selain itu dari tahapan. */
export function projectProgress(t: { done: number; total: number }, m: { done: number; total: number }) {
  if (t.total > 0) return { pct: (t.done / t.total) * 100, label: `${t.done} dari ${t.total} tugas`, source: 'tugas' as const }
  if (m.total > 0) return { pct: (m.done / m.total) * 100, label: `${m.done} dari ${m.total} tahapan`, source: 'tahapan' as const }
  return { pct: 0, label: 'Belum ada tugas atau tahapan', source: null }
}
