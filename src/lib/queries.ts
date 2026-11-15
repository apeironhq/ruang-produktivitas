import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { progressPercent } from './format'
import type { Goal, GoalProgressRow, GoalWithProgress, Option } from './types'

export const GOAL_COLUMNS = 'id, title, description, category, metric_type, unit_label, direction, progress_source, start_value, target_value, priority, start_date, due_date, status, achieved_at, created_at'

/**
 * Ambil baris progres (view goal_progress) — dijalankan PARALEL dengan query target, bukan sesudahnya.
 * Tanpa goalId: semua target milik pengguna (RLS membatasi ke miliknya sendiri).
 */
export async function loadProgress(supabase: SupabaseClient, goalId?: string): Promise<GoalProgressRow[]> {
  let q = supabase.from('goal_progress').select('goal_id, current_value, effective_target, effective_start, item_total, item_done')
  if (goalId) q = q.eq('goal_id', goalId)
  const { data } = await q.limit(1000)
  return (data ?? []) as GoalProgressRow[]
}

/** Gabungkan target dengan progres dari view goal_progress (satu sumber kebenaran). */
export function mergeProgress(goals: Goal[], rows: GoalProgressRow[]): GoalWithProgress[] {
  const map = new Map(rows.map((r) => [r.goal_id, r]))
  return goals.map((g) => {
    const p = map.get(g.id)
    const current = Number(p?.current_value ?? g.start_value)
    const effTarget = Number(p?.effective_target ?? g.target_value)
    const effStart = Number(p?.effective_start ?? g.start_value)
    const pct = g.status === 'tercapai' ? 100 : progressPercent(current, effStart, effTarget)
    return { ...g, current, effTarget, effStart, percent: pct, itemTotal: Number(p?.item_total ?? 0), itemDone: Number(p?.item_done ?? 0) }
  })
}

/** Pilihan relasi untuk formulir (target aktif, bidang belajar, proyek). */
export async function loadLinkOptions(supabase: SupabaseClient) {
  const [goals, subjects, projects] = await Promise.all([
    supabase.from('goals').select('id, title').neq('status', 'arsip').order('created_at', { ascending: false }).limit(200),
    supabase.from('learning_subjects').select('id, title').neq('status', 'arsip').order('title').limit(200),
    supabase.from('projects').select('id, title').neq('status', 'arsip').order('title').limit(200),
  ])
  return {
    goals: (goals.data ?? []) as Option[],
    subjects: (subjects.data ?? []) as Option[],
    projects: (projects.data ?? []) as Option[],
  }
}
export type LinkOptions = Awaited<ReturnType<typeof loadLinkOptions>>
