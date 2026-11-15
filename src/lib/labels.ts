// Label & nada (tone) bahasa Indonesia untuk nilai enum di database.

export type Tone = 'tone-neutral' | 'tone-brand' | 'tone-warn' | 'tone-err' | 'tone-info'

export const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  belum: { label: 'Belum Dimulai', tone: 'tone-neutral' },
  dikerjakan: { label: 'Dikerjakan', tone: 'tone-info' },
  tertunda: { label: 'Tertunda', tone: 'tone-warn' },
  selesai: { label: 'Selesai', tone: 'tone-brand' },
  dibatalkan: { label: 'Dibatalkan', tone: 'tone-err' },
}
export const TASK_STATUS_ORDER = ['belum', 'dikerjakan', 'tertunda', 'selesai', 'dibatalkan'] as const

/** Label status kegiatan: kegiatan tidak "dikerjakan", melainkan terjadwal lalu lewat. */
export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  belum: { label: 'Terjadwal', tone: 'tone-info' },
  dikerjakan: { label: 'Berlangsung', tone: 'tone-info' },
  tertunda: { label: 'Ditunda', tone: 'tone-warn' },
  selesai: { label: 'Selesai', tone: 'tone-brand' },
  dibatalkan: { label: 'Dibatalkan', tone: 'tone-err' },
}

/** Status yang ditampilkan untuk tugas maupun kegiatan (kegiatan yang sudah lewat → "Sudah lewat"). */
export function displayStatus(t: { kind: string; status: string; start_at?: string | null; end_at?: string | null }, nowIso = new Date().toISOString()) {
  if (t.kind !== 'kegiatan') return TASK_STATUS[t.status]!
  const until = t.end_at ?? t.start_at
  if (t.status === 'belum' && until && until < nowIso) return { label: 'Sudah lewat', tone: 'tone-neutral' as Tone }
  return EVENT_STATUS[t.status]!
}
export const OPEN_STATUSES = ['belum', 'dikerjakan', 'tertunda'] as const

export const PRIORITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  rendah: { label: 'Rendah', tone: 'tone-neutral', rank: 1 },
  sedang: { label: 'Sedang', tone: 'tone-info', rank: 2 },
  tinggi: { label: 'Tinggi', tone: 'tone-warn', rank: 3 },
  mendesak: { label: 'Mendesak', tone: 'tone-err', rank: 4 },
}

export const TASK_KIND: Record<string, string> = { tugas: 'Tugas', kegiatan: 'Kegiatan' }

export const GOAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  aktif: { label: 'Aktif', tone: 'tone-info' },
  tercapai: { label: 'Tercapai', tone: 'tone-brand' },
  arsip: { label: 'Diarsipkan', tone: 'tone-neutral' },
}

export const METRIC: Record<string, { label: string; hint: string }> = {
  rupiah: { label: 'Rupiah', hint: 'Mis. menabung Rp100.000.000' },
  jumlah: { label: 'Jumlah', hint: 'Mis. membaca 12 buku' },
  durasi: { label: 'Durasi (menit)', hint: 'Mis. 3.000 menit latihan' },
  persentase: { label: 'Persentase', hint: 'Mis. skor 0–100%' },
  biner: { label: 'Selesai / belum', hint: 'Tercapai sekali tandai' },
}

export const PROGRESS_SOURCE: Record<string, { label: string; hint: string }> = {
  manual: { label: 'Kontribusi manual', hint: 'Anda mencatat penambahan/pengurangan nilai sendiri.' },
  modul: { label: 'Modul belajar', hint: 'Dihitung dari modul selesai pada bidang belajar yang ditautkan.' },
  tugas: { label: 'Tugas tertaut', hint: 'Dihitung dari tugas tertaut yang selesai (dibatalkan tidak dihitung).' },
}

export const SOURCE_TYPE: Record<string, string> = {
  tautan: 'Tautan', buku: 'Buku', pdf: 'PDF', video: 'Video', kursus: 'Kursus', catatan: 'Catatan',
}

export const SUBJECT_STATUS: Record<string, { label: string; tone: Tone }> = {
  aktif: { label: 'Aktif', tone: 'tone-info' },
  selesai: { label: 'Selesai', tone: 'tone-brand' },
  arsip: { label: 'Diarsipkan', tone: 'tone-neutral' },
}

export const JOURNAL_KIND: Record<string, { label: string; color: string; desc: string }> = {
  catatan: { label: 'Catatan', color: 'var(--c-blue)', desc: 'Catatan bebas, referensi, ringkasan' },
  harian: { label: 'Jurnal Harian', color: 'var(--c-lilac)', desc: 'Refleksi dan cerita hari ini' },
  belajar: { label: 'Jurnal Belajar', color: 'var(--c-blue)', desc: 'Pemahaman dan catatan materi' },
  trading: { label: 'Jurnal Trading', color: 'var(--c-peach)', desc: 'Analisis posisi dan evaluasi' },
  pekerjaan: { label: 'Pekerjaan', color: '#475467', desc: 'Catatan rapat dan pekerjaan' },
  ide: { label: 'Ide', color: 'var(--c-rose)', desc: 'Ide, gagasan, rencana' },
  khusus: { label: 'Khusus', color: '#475467', desc: 'Jenis buatan sendiri (pakai tag)' },
}

export const MOOD: Record<number, string> = { 1: 'Sangat buruk', 2: 'Kurang baik', 3: 'Biasa', 4: 'Baik', 5: 'Sangat baik' }
