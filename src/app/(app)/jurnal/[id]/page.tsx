import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, ArchiveRestore, Info, LineChart, NotebookPen, Trash2 } from 'lucide-react'
import { EditJournalButton } from '../JournalForm'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { BackLink, DetailTitle, InfoList, SectionHead, StatTile } from '@/components/ui/display'
import { formatDateTime, formatDay, formatDayLong, formatNumber } from '@/lib/format'
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
  const [{ data }, goals, subjects, projects] = await Promise.all([
    supabase.from('journal_entries').select('*').eq('id', id).maybeSingle(),
    supabase.from('goals').select('id, title').limit(1000),
    supabase.from('learning_subjects').select('id, title').limit(1000),
    supabase.from('projects').select('id, title').limit(1000),
  ])
  if (!data) notFound()
  const e = data as JournalEntry
  const goal = { data: (goals.data ?? []).find((g) => g.id === e.goal_id) ?? null }
  const subject = { data: (subjects.data ?? []).find((s) => s.id === e.subject_id) ?? null }
  const project = (projects.data ?? []).find((p) => p.id === e.project_id) ?? null
  const k = JOURNAL_KIND[e.kind]!
  const t = e.kind === 'trading' ? e.trading : null
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatNumber(v))
  // Perubahan harga sesuai arah posisi (jual/short untung saat harga turun).
  const move = t && t.entry_price && t.exit_price ? ((t.exit_price - t.entry_price) / t.entry_price) * 100 * (t.side === 'jual' ? -1 : 1) : null
  const pctFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
  // Ringkasan dasar kartu Informasi: panjang catatan & perkiraan waktu baca (±200 kata/menit).
  const words = `${e.title} ${e.content} ${t?.evaluation ?? ''}`.trim().split(/\s+/).filter(Boolean).length
  const readMin = Math.max(1, Math.round(words / 200))

  return (
    <div className="page">
      <BackLink href="/jurnal">Catatan & Jurnal</BackLink>
      <div className="page-head">
        <div className="min-w-0" style={{ '--tone-fg': k.color } as React.CSSProperties}>
          <DetailTitle title={e.title || 'Tanpa judul'} status={{ label: k.label, tone: '' }}
            meta={[formatDayLong(e.entry_date), e.is_archived ? 'Diarsipkan' : null]} />
        </div>
        <div className="control-row">
          <EditJournalButton goals={goals.data ?? []} subjects={subjects.data ?? []} projects={projects.data ?? []}
            initial={{ id: e.id, kind: e.kind, title: e.title, content: e.content, entry_date: e.entry_date, tags: e.tags.join(', '), mood: e.mood, goal_id: e.goal_id, subject_id: e.subject_id, project_id: e.project_id, trading: e.trading }} />
          <ActionButton action={setArchived.bind(null, e.id, !e.is_archived)} className={`btn btn-secondary${e.is_archived ? '' : ' is-warn'}`}>{e.is_archived ? <><ArchiveRestore size={16} />Kembalikan</> : <><Archive size={16} />Arsipkan</>}</ActionButton>
          <ConfirmButton action={deleteEntry.bind(null, e.id)} redirect="/jurnal" title="Hapus catatan?" message={`"${e.title || 'Tanpa judul'}" akan dihapus permanen. Pilih Arsipkan jika hanya ingin menyembunyikannya.`}
            className="btn btn-secondary btn-icon is-danger" ariaLabel="Hapus catatan"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="row-2 cols-even">
        <div className="flex flex-col gap-4 min-w-0">
          {t && (
            <section className="card" aria-labelledby="trade-title">
              <SectionHead id="trade-title" icon={<LineChart size={18} />} title="Detail trading" desc="Catatan analisis — tidak dihitung sebagai transaksi keuangan" />
              <div className="card-body">
                <div className="trade-head">
                  <strong>{t.instrument || 'Tanpa instrumen'}</strong>
                  <div className="chips">
                    {t.side && <span className={`chip ${t.side === 'beli' ? 'up' : 'down'}`}>{t.side === 'beli' ? 'Beli / long' : 'Jual / short'}</span>}
                    {t.strategy && <span className="chip">{t.strategy}</span>}
                  </div>
                </div>
                <div className="stat-tiles">
                  <StatTile label="Harga masuk" value={num(t.entry_price)} />
                  <StatTile label="Harga keluar" value={num(t.exit_price)}
                    sub={move === null ? undefined : <span className={move >= 0 ? 'up-text' : 'down-text'}>{move >= 0 ? '+' : '−'}{pctFmt.format(Math.abs(move))}%</span>} />
                  <StatTile label="Biaya" value={num(t.fee)} />
                  <StatTile label="Hasil" value={t.result === null || t.result === undefined ? '—' : `${t.result > 0 ? '+' : t.result < 0 ? '−' : ''}${formatNumber(Math.abs(t.result))}`}
                    tone={t.result === null || t.result === undefined || t.result === 0 ? undefined : t.result > 0 ? 'ok' : 'err'} />
                </div>
                {t.evaluation && (
                  <div className="note-quote mt-4"><span>Evaluasi</span><p>{t.evaluation}</p></div>
                )}
              </div>
            </section>
          )}
          <article className="card" aria-labelledby="isi-title">
            <SectionHead id="isi-title" icon={<NotebookPen size={18} />} title="Isi catatan" />
            <div className="card-body">
              {e.content ? <div className="prose-plain text-[1rem]">{e.content}</div> : <p className="text-caption">Belum ada isi. Tekan <strong>Ubah</strong> di atas untuk menulis.</p>}
            </div>
          </article>
        </div>

        <aside className="card detail-aside" aria-labelledby="info-title">
          <SectionHead id="info-title" icon={<Info size={18} />} title="Informasi" />
          <div className="card-body">
            <InfoList items={[
              ['Jenis', <span key="k" className="inline-flex items-center gap-1.5"><span className="log-dot" style={{ background: k.color }} aria-hidden="true" />{k.label}</span>],
              ['Tanggal', formatDay(e.entry_date)],
              e.mood ? ['Suasana', MOOD[e.mood]] : null,
              e.is_archived ? ['Status', 'Diarsipkan'] : null,
              ['Tag', e.tags.length ? <span key="t" className="tags">{e.tags.map((tag) => <Link key={tag} href={`/jurnal?tag=${encodeURIComponent(tag)}`} className="tag hover:bg-[var(--brand-soft)]">#{tag}</Link>)}</span> : '—'],
              project ? ['Proyek', <Link key="p" href={`/proyek/${project.id}`}>{project.title}</Link>] : null,
              goal.data ? ['Target', <Link key="g" href={`/target/${goal.data.id}`}>{goal.data.title}</Link>] : null,
              subject.data ? ['Bidang belajar', <Link key="s" href={`/belajar/${subject.data.id}`}>{subject.data.title}</Link>] : null,
              ['Diperbarui', formatDateTime(e.updated_at, user.timezone)],
              ['Dibuat', formatDateTime(e.created_at, user.timezone)],
            ]} />
            <div className="panel-foot"><span>Panjang catatan</span><strong>{formatNumber(words)} kata · ±{readMin} menit baca</strong></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
