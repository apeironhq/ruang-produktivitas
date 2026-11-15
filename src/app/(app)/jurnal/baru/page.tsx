import type { Metadata } from 'next'
import { BackLink, PageHead } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { JOURNAL_KIND } from '@/lib/labels'
import { loadLinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { JournalEntry } from '@/lib/types'
import { str } from '@/lib/url'
import { JournalEditor } from '../Editor'

export const metadata: Metadata = { title: 'Catatan baru' }

export default async function Page({ searchParams }: PageProps<'/jurnal/baru'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const options = await loadLinkOptions(supabase)
  const jenis = str(sp.jenis)
  const kind = (JOURNAL_KIND[jenis] ? jenis : 'catatan') as JournalEntry['kind']
  const goal = options.goals.find((g) => g.id === str(sp.target))?.id ?? null
  const subject = options.subjects.find((s) => s.id === str(sp.bidang))?.id ?? null
  return (
    <div className="page">
      <BackLink href="/jurnal">Catatan & Jurnal</BackLink>
      <PageHead title="Catatan baru" description="Tulis bebas. Jenis, tag, dan tautan bisa diatur di panel samping." />
      <JournalEditor goals={options.goals} subjects={options.subjects} cancelHref="/jurnal"
        initial={{ kind, title: '', content: '', entry_date: todayIn(user.timezone), tags: '', mood: null, goal_id: goal, subject_id: subject, trading: null }} />
    </div>
  )
}
