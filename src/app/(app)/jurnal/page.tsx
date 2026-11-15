import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, NotebookPen, Plus } from 'lucide-react'
import { EmptyState, PageHead } from '@/components/ui/display'
import { ParamSelect, SearchParamInput } from '@/components/ui/filters'
import { formatDay, formatNumber } from '@/lib/format'
import { JOURNAL_KIND } from '@/lib/labels'
import { createClient } from '@/lib/supabase/server'
import type { JournalEntry } from '@/lib/types'
import { hrefWith, pageHref, str } from '@/lib/url'

export const metadata: Metadata = { title: 'Catatan & Jurnal' }

const PER_PAGE = 20

export default async function Page({ searchParams }: PageProps<'/jurnal'>) {
  const sp = await searchParams
  const supabase = await createClient()
  const kind = JOURNAL_KIND[str(sp.jenis)] ? str(sp.jenis) : ''
  const q = str(sp.q).slice(0, 100)
  const tag = str(sp.tag).slice(0, 40)
  const period = str(sp.periode)
  const archived = str(sp.arsip) === '1'
  const page = Math.max(1, Number.parseInt(str(sp.hal) || '1', 10) || 1)

  let query = supabase.from('journal_entries').select('id, kind, title, content, entry_date, tags, mood, is_archived, created_at', { count: 'exact' }).eq('is_archived', archived)
  if (kind) query = query.eq('kind', kind)
  if (tag) query = query.contains('tags', [tag])
  if (q) {
    const safe = q.replace(/[%_\\,()]/g, ' ').trim()
    if (safe) query = query.or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number)
    const next = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`
    query = query.gte('entry_date', `${period}-01`).lt('entry_date', `${next}-01`)
  }
  const { data, count } = await query.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PER_PAGE, page * PER_PAGE - 1)
  const entries = (data ?? []) as JournalEntry[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  // Pilihan bulan: 12 bulan terakhir
  const now = new Date()
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return { value: v, label: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) }
  })
  const filtered = !!(q || tag || period || kind)

  return (
    <div className="page">
      <PageHead title="Catatan & Jurnal" description="Catatan bebas, jurnal harian, belajar, trading, dan ide — dalam satu tempat."
        actions={<Link href={kind ? `/jurnal/baru?jenis=${kind}` : '/jurnal/baru'} className="btn btn-primary"><Plus size={16} />Catatan baru</Link>} />

      <nav className="tabs" aria-label="Jenis catatan">
        <Link href={hrefWith('/jurnal', sp, { jenis: null })} className={`tab${!kind ? ' active' : ''}`}>Semua</Link>
        {Object.entries(JOURNAL_KIND).map(([k, v]) => (
          <Link key={k} href={hrefWith('/jurnal', sp, { jenis: k })} className={`tab${kind === k ? ' active' : ''}`}>{v.label}</Link>
        ))}
      </nav>

      <div className="control-row">
        <SearchParamInput label="Cari catatan" placeholder="Cari judul atau isi…" />
        <ParamSelect param="periode" label="Bulan" options={[{ value: '', label: 'Semua tanggal' }, ...months]} />
        <ParamSelect param="arsip" label="Arsip" options={[{ value: '', label: 'Tidak diarsipkan' }, { value: '1', label: 'Diarsipkan' }]} />
      </div>
      {tag && <p className="text-caption">Menyaring tag <span className="tag">#{tag}</span> · <Link href={hrefWith('/jurnal', sp, { tag: null })} className="link">hapus saringan</Link></p>}

      <section className="card" aria-label="Daftar catatan">
        {entries.length === 0 ? (
          <EmptyState icon={<NotebookPen size={20} strokeWidth={1.75} />} title={filtered ? 'Tidak ada yang cocok' : archived ? 'Arsip kosong' : 'Belum ada catatan'}
            description={filtered ? 'Coba kata kunci atau saringan lain.' : 'Tulis catatan atau jurnal pertama Anda.'}
            action={!filtered && !archived ? <Link href="/jurnal/baru" className="btn btn-primary"><Plus size={16} />Catatan baru</Link> : undefined} />
        ) : (
          <>
            <ul className="items">
              {entries.map((e) => {
                const k = JOURNAL_KIND[e.kind]!
                return (
                  <li key={e.id} className="border-b border-[var(--border)] last:border-0">
                    <Link href={`/jurnal/${e.id}`} className="flex gap-4 px-5 py-4 hover:bg-[var(--bg-subtle)]">
                      <span className="hidden sm:flex flex-col items-center w-12 shrink-0 text-center">
                        <span className="text-[1.25rem] leading-none font-medium text-[var(--text-heading)]">{formatDay(e.entry_date, { day: 'numeric' })}</span>
                        <span className="text-caption">{formatDay(e.entry_date, { month: 'short' })}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="badge badge-dot" style={{ '--tone-fg': k.color } as React.CSSProperties}>{k.label}</span>
                          <span className="item-meta sm:hidden">{formatDay(e.entry_date)}</span>
                        </span>
                        <span className="item-title block truncate">{e.title || 'Tanpa judul'}</span>
                        {e.content && <span className="item-sub block line-clamp-2 mt-0.5">{e.content.slice(0, 280)}</span>}
                        {e.tags.length > 0 && <span className="flex gap-1.5 flex-wrap mt-2">{e.tags.slice(0, 6).map((t) => <span key={t} className="tag">#{t}</span>)}</span>}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <nav className="flex items-center justify-between gap-4 flex-wrap px-5 py-4 border-t border-[var(--border)]" aria-label="Paginasi">
              <p className="text-caption">Menampilkan <strong className="text-[var(--text-heading)]">{formatNumber((page - 1) * PER_PAGE + 1)}–{formatNumber(Math.min(total, page * PER_PAGE))}</strong> dari <strong className="text-[var(--text-heading)]">{formatNumber(total)}</strong></p>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  {page > 1 ? <Link className="btn btn-secondary btn-sm btn-icon" aria-label="Halaman sebelumnya" href={pageHref('/jurnal', sp, page - 1)}><ChevronLeft size={16} /></Link>
                    : <span className="btn btn-secondary btn-sm btn-icon" aria-disabled="true"><ChevronLeft size={16} /></span>}
                  <span className="text-label font-normal">Halaman {page} / {pages}</span>
                  {page < pages ? <Link className="btn btn-secondary btn-sm btn-icon" aria-label="Halaman berikutnya" href={pageHref('/jurnal', sp, page + 1)}><ChevronRight size={16} /></Link>
                    : <span className="btn btn-secondary btn-sm btn-icon" aria-disabled="true"><ChevronRight size={16} /></span>}
                </div>
              )}
            </nav>
          </>
        )}
      </section>
    </div>
  )
}
