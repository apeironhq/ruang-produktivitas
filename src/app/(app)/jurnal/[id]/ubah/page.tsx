import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BackLink, PageHead } from '@/components/ui/display'
import { loadLinkOptions } from '@/lib/queries'
import { createClient } from '@/lib/supabase/server'
import type { JournalEntry } from '@/lib/types'
import { JournalEditor } from '../../Editor'

export const metadata: Metadata = { title: 'Ubah catatan' }

export default async function Page({ params }: PageProps<'/jurnal/[id]/ubah'>) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createClient()
  const [{ data }, options] = await Promise.all([
    supabase.from('journal_entries').select('*').eq('id', id).maybeSingle(),
    loadLinkOptions(supabase),
  ])
  if (!data) notFound()
  const e = data as JournalEntry
  return (
    <div className="page">
      <BackLink href={`/jurnal/${id}`}>Kembali ke catatan</BackLink>
      <PageHead title="Ubah catatan" />
      <JournalEditor goals={options.goals} subjects={options.subjects} cancelHref={`/jurnal/${id}`}
        initial={{ id: e.id, kind: e.kind, title: e.title, content: e.content, entry_date: e.entry_date, tags: e.tags.join(', '), mood: e.mood, goal_id: e.goal_id, subject_id: e.subject_id, trading: e.trading }} />
    </div>
  )
}
