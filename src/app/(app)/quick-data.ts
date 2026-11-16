'use server'

import { todayIn } from '@/lib/dates'
import { loadAccounts, loadCategories } from '@/lib/finance'
import { loadLinkOptions, type LinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { AccountWithBalance, Category } from '@/lib/types'
import type { SubjectBundle } from './belajar/LearningForms'

export interface QuickData { today: string; options: LinkOptions; bundles: SubjectBundle[]; accounts: AccountWithBalance[]; categories: Category[] }

/** Data pilihan untuk popup "Tambah" di topbar — dimuat saat menu dibuka, bukan di setiap halaman. */
export async function loadQuickData(): Promise<QuickData | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()
  const [options, sources, modules, accounts, categories] = await Promise.all([
    loadLinkOptions(supabase),
    supabase.from('learning_sources').select('id, subject_id, title, position').limit(1000),
    supabase.from('learning_modules').select('id, subject_id, title, completed_at').eq('is_applicable', true).order('sort_order').limit(2000),
    loadAccounts(supabase),
    loadCategories(supabase),
  ])
  const bundles: SubjectBundle[] = options.subjects.map((s) => ({
    id: s.id, title: s.title,
    sources: (sources.data ?? []).filter((x) => x.subject_id === s.id),
    modules: (modules.data ?? []).filter((m) => m.subject_id === s.id),
  }))
  return { today: todayIn(user.timezone), options, bundles, accounts, categories }
}
