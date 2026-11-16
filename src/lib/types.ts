// Bentuk baris tabel (sesuai supabase/migrations). Angka numeric dikirim PostgREST sebagai number.

export interface Goal {
  id: string
  title: string
  description: string
  category: string
  metric_type: 'rupiah' | 'jumlah' | 'durasi' | 'persentase' | 'biner'
  unit_label: string
  direction: 'naik' | 'turun'
  progress_source: 'manual' | 'alokasi' | 'modul' | 'tugas'
  start_value: number
  target_value: number
  priority: 'rendah' | 'sedang' | 'tinggi'
  start_date: string
  due_date: string | null
  status: 'aktif' | 'tercapai' | 'arsip'
  achieved_at: string | null
  created_at: string
}

export interface GoalProgressRow {
  goal_id: string
  current_value: number
  effective_target: number
  effective_start: number
  item_total: number
  item_done: number
}

export interface GoalWithProgress extends Goal {
  current: number
  effTarget: number
  effStart: number
  percent: number
  itemTotal: number
  itemDone: number
}

export interface Milestone {
  id: string
  goal_id: string
  title: string
  threshold: number
  reached_at: string | null
}

export interface GoalEvent {
  id: string
  goal_id: string
  value: number
  note: string
  occurred_on: string
  source_type: string
  created_at: string
}

export interface Subject {
  id: string
  title: string
  description: string
  status: 'aktif' | 'selesai' | 'arsip'
  goal_id: string | null
  created_at: string
  updated_at: string
}

export interface Source {
  id: string
  subject_id: string
  title: string
  source_type: 'tautan' | 'buku' | 'pdf' | 'video' | 'kursus' | 'catatan'
  url: string
  position: string
  notes: string
  updated_at: string
}

export interface Module {
  id: string
  subject_id: string
  title: string
  sort_order: number
  is_applicable: boolean
  completed_at: string | null
}

export interface Session {
  id: string
  subject_id: string
  source_id: string | null
  module_id: string | null
  session_date: string
  duration_minutes: number
  material: string
  position: string
  summary: string
  obstacles: string
  next_steps: string
  created_at: string
}

export interface Task {
  id: string
  kind: 'tugas' | 'kegiatan'
  title: string
  description: string
  category: string
  priority: 'rendah' | 'sedang' | 'tinggi' | 'mendesak'
  status: 'belum' | 'dikerjakan' | 'tertunda' | 'selesai' | 'dibatalkan'
  due_at: string | null
  start_at: string | null
  end_at: string | null
  location: string
  completed_at: string | null
  goal_id: string | null
  project_id: string | null
  subject_id: string | null
  recurrence: 'tidak' | 'harian' | 'mingguan' | 'bulanan'
  remind_before_minutes: number | null
  created_at: string
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  is_completed: boolean
  sort_order: number
}

export interface TradingFields {
  instrument?: string
  strategy?: string
  side?: 'beli' | 'jual' | ''
  entry_price?: number | null
  exit_price?: number | null
  fee?: number | null
  result?: number | null
  evaluation?: string
}

export interface JournalEntry {
  id: string
  kind: 'catatan' | 'harian' | 'belajar' | 'trading' | 'pekerjaan' | 'ide' | 'khusus'
  title: string
  content: string
  entry_date: string
  tags: string[]
  trading: TradingFields | null
  mood: number | null
  is_archived: boolean
  goal_id: string | null
  subject_id: string | null
  project_id: string | null
  task_id: string | null
  created_at: string
  updated_at: string
}

export interface Option { id: string; title: string }

// ---------- Proyek ----------
export interface Project {
  id: string
  title: string
  description: string
  status: 'rencana' | 'aktif' | 'selesai' | 'ditunda' | 'arsip'
  goal_id: string | null
  start_date: string | null
  due_date: string | null
  created_at: string
  updated_at: string
}
export interface ProjectMilestone { id: string; project_id: string; title: string; due_date: string | null; completed_at: string | null; sort_order: number }

// ---------- Kebiasaan & lencana ----------
export interface Habit {
  id: string
  name: string
  description: string
  frequency: 'harian' | 'mingguan'
  times_per_week: number
  is_archived: boolean
  created_at: string
}
export interface Achievement { id: string; code: string; name: string; description: string; icon: string; metric: string; min_value: number; sort_order: number }

// ---------- Keuangan ----------
export interface Account {
  id: string
  name: string
  kind: 'tunai' | 'bank' | 'dompet_digital' | 'lainnya'
  opening_balance: number
  is_archived: boolean
  created_at: string
}
export interface AccountWithBalance extends Account { balance: number; allocated: number }

export interface Category { id: string; name: string; type: 'pemasukan' | 'pengeluaran' }

export interface Transaction {
  id: string
  account_id: string
  type: 'pemasukan' | 'pengeluaran' | 'transfer_keluar' | 'transfer_masuk'
  amount: number
  category_id: string | null
  occurred_on: string
  note: string
  transfer_group_id: string | null
  created_at: string
}

export interface Budget { id: string; category_id: string; month: string; limit_amount: number }

export interface Allocation { id: string; goal_id: string; account_id: string; amount: number; occurred_on: string; note: string; created_at: string }
