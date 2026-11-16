import { NextResponse } from 'next/server'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

const TABLES = [
  'goals', 'goal_milestones', 'goal_progress_events', 'projects',
  'learning_subjects', 'learning_sources', 'learning_modules', 'learning_sessions',
  'tasks', 'task_subtasks', 'journal_entries', 'project_milestones', 'habits', 'habit_checkins', 'user_achievements',
  'financial_accounts', 'transaction_categories', 'transactions', 'budgets', 'goal_allocations',
  'reminder_logs', 'telegram_connections',
] as const

/** Ekspor seluruh data milik pengguna (AK-04). RLS memastikan hanya baris milik sendiri yang terbaca. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Tidak masuk.' }, { status: 401 })
  const supabase = await createClient()
  const out: Record<string, unknown> = {
    format: 'ruang-produktivitas/ekspor@1',
    exported_at: new Date().toISOString(),
    profile: { display_name: user.displayName, email: user.email, timezone: user.timezone },
  }
  for (const t of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(t).select('*').range(from, from + 999)
      if (error) return NextResponse.json({ error: 'Gagal mengekspor data.' }, { status: 500 })
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    out[t] = rows
  }
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="ruang-produktivitas-${date}.json"`,
      'cache-control': 'no-store',
    },
  })
}
