// Tipe data Mini App (aman dipakai di klien).
export interface MiniItem { id: string; title: string; time: string; late: boolean; kind: 'tugas' | 'kegiatan'; sub?: string }

export interface MiniHome {
  name: string
  greeting: string
  dateLabel: string
  today: string
  stats: { tasks: number; sessions: number; sessionMinutes: string; expense: string; goals: number }
  agenda: MiniItem[]
  more: number
  notifCount: number
  siteUrl: string
  subjects: Array<{ id: string; title: string }>
}

export type MiniView =
  | { view: 'tugas'; groups: Array<{ title: string; tone?: 'late'; items: MiniItem[] }> }
  | { view: 'belajar'; total: string; count: number; subjects: Array<{ id: string; title: string; minutes: string; pct: number }>; recent: Array<{ title: string; sub: string; right: string }> }
  | { view: 'target'; goals: Array<{ id: string; title: string; percent: number; sub: string; due: string }> }
  | { view: 'uang'; month: string; income: string; expense: string; diff: string; diffNeg: boolean; today: string; top: Array<{ name: string; amount: string; pct: number }>; recent: Array<{ title: string; sub: string; amount: string; income: boolean }> }
  | { view: 'ringkasan'; rows: Array<{ label: string; cur: string; prev: string; trend: 'up' | 'down' | 'flat' }> }
  | { view: 'notif'; upcoming: Array<{ title: string; sub: string; right: string }>; recent: Array<{ title: string; sub: string; status: 'terkirim' | 'gagal' | 'dilewati' }> }

export type MiniViewName = MiniView['view']
export type MiniResult = { ok: true; message: string } | { ok: false; message: string }
