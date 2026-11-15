import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, ArchiveRestore, BookOpen, Info, LineChart, NotebookPen, Target, Trash2 } from 'lucide-react'
import { EditJournalButton } from '../JournalForm'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { BackLink, SectionHead } from '@/components/ui/display'
import { formatDateTime, formatDayLong, formatNumber } from '@/lib/format'
import { JOURNAL_KIND, MOOD } from '@/lib/labels'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { JournalEntry } from '@/lib/types'
import { deleteEntry, setArchived } from '../actions'

export const metadata: Metadata = { title: 'Catatan' }

export default async function Page({ params }: PageProps<'/jurnal/[id]'>) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  // Satu putaran paralel: catatan + judul target/bidang (dicocokkan di memori).
  const [{ data }, goals, subjects] = await Promise.all([
    supabase.from('journal_entries').select('*').eq('id', id).maybeSingle(),
    supabase.from('goals').select('id, title').limit(1000),
    supabase.from('learning_subjects').select('id, title').limit(1000),
  ])
  if (!data) notFound()
  const e = data as JournalEntry
  const goal = { data: (goals.data ?? []).find((g) => g.id === e.goal_id) ?? null }
  const subject = { data: (subjects.data ?? []).find((s) => s.id === e.subject_id) ?? null }
  const k = JOURNAL_KIND[e.kind]!
  const t = e.kind === 'trading' ? e.trading : null
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatNumber(v))

  return (
    <div className="page">
      <BackLink href="/jurnal">Catatan & Jurnal</BackLink>
      <div className="page-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="badge badge-dot" style={{ '--tone-fg': k.color } as React.CSSProperties}>{k.label}</span>
            {e.is_archived && <span className="badge">Diarsipkan</span>}
            {e.mood && <span className="badge">Suasana: {MOOD[e.mood]}</span>}
          </div>
          <h1 className="break-words">{e.title || 'Tanpa judul'}</h1>
          <p className="text-caption mt-1">{formatDayLong(e.entry_date)} · diperbarui {formatDateTime(e.updated_at, user.timezone)}</p>
        </div>
        <div className="control-row">
          <EditJournalButton goals={goals.data ?? []} subjects={subjects.data ?? []}
            initial={{ id: e.id, kind: e.kind, title: e.title, content: e.content, entry_date: e.entry_date, tags: e.tags.join(', '), mood: e.mood, goal_id: e.goal_id, subject_id: e.subject_id, trading: e.trading }} />
          <ActionButton action={setArchived.bind(null, e.id, !e.is_archived)}>{e.is_archived ? <><ArchiveRestore size={16} />Kembalikan</> : <><Archive size={16} />Arsipkan</>}</ActionButton>
          <ConfirmButton action={deleteEntry.bind(null, e.id)} redirect="/jurnal" title="Hapus catatan?" message={`"${e.title || 'Tanpa judul'}" akan dihapus permanen. Pilih Arsipkan jika hanya ingin menyembunyikannya.`}
            className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus catatan"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="row-2" style={{ alignItems: 'start' }}>
        <div className="flex flex-col gap-4 min-w-0">
        <article className="card" aria-labelledby="isi-title">
          <SectionHead id="isi-title" icon={<NotebookPen size={18} />} title="Isi catatan" />
          <div className="card-body">
            {e.content ? <div className="prose-plain text-[1rem]">{e.content}</div> : <p className="text-caption">Belum ada isi.</p>}
          </div>
        </article>
          {t && (
            <section className="card" aria-labelledby="trade-title">
              <SectionHead id="trade-title" icon={<LineChart size={18} />} title="Detail trading" desc="Catatan analisis — tidak dihitung sebagai transaksi keuangan" />
              <div className="card-body">
              <dl className="dl">
                <div><dt>Instrumen</dt><dd>{t.instrument || '—'}</dd></div>
                <div><dt>Posisi</dt><dd>{t.side === 'beli' ? 'Beli / long' : t.side === 'jual' ? 'Jual / short' : '—'}</dd></div>
                <div className="col-span-full"><dt>Strategi</dt><dd>{t.strategy || '—'}</dd></div>
                <div><dt>Harga masuk</dt><dd>{num(t.entry_price)}</dd></div>
                <div><dt>Harga keluar</dt><dd>{num(t.exit_price)}</dd></div>
                <div><dt>Biaya</dt><dd>{num(t.fee)}</dd></div>
                <div><dt>Hasil</dt><dd style={{ color: (t.result ?? 0) < 0 ? 'var(--err)' : undefined }}>{num(t.result)}</dd></div>
                {t.evaluation && <div className="col-span-full"><dt>Evaluasi</dt><dd className="prose-plain font-normal">{t.evaluation}</dd></div>}
              </dl>
              </div>
            </section>
          )}
        </div>
        <aside className="card h-fit" aria-labelledby="info-title">
          <SectionHead id="info-title" icon={<Info size={18} />} title="Informasi" />
          <div className="card-body flex flex-col gap-4">
            <div>
              <p className="text-overline mb-2">Tag</p>
              {e.tags.length ? <div className="flex gap-1.5 flex-wrap">{e.tags.map((tag) => <Link key={tag} href={`/jurnal?tag=${encodeURIComponent(tag)}`} className="tag hover:bg-[var(--brand-soft)]">#{tag}</Link>)}</div> : <p className="text-caption">—</p>}
            </div>
            <div>
              <p className="text-overline mb-2">Terkait</p>
              {!goal.data && !subject.data && <p className="text-caption">Tidak ada.</p>}
              {goal.data && <Link href={`/target/${goal.data.id}`} className="flex items-center gap-2 py-1 text-label hover:text-[var(--brand)]"><Target size={15} aria-hidden="true" />{goal.data.title}</Link>}
              {subject.data && <Link href={`/belajar/${subject.data.id}`} className="flex items-center gap-2 py-1 text-label hover:text-[var(--brand)]"><BookOpen size={15} aria-hidden="true" />{subject.data.title}</Link>}
            </div>
            <p className="text-caption">Dibuat {formatDateTime(e.created_at, user.timezone)}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
