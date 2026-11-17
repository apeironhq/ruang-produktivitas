import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react'
import { EmptyState, PageHead, SectionHead } from '@/components/ui/display'
import { FilterBar } from '@/components/ui/FilterBar'
import { ParamSelect, SearchParamInput } from '@/components/ui/filters'
import { todayIn } from '@/lib/dates'
import { TX_COLS, loadAccounts, loadCategories, monthLabel, monthRange, sumFlow, toRows } from '@/lib/finance'
import { formatNumber, formatRupiah } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Transaction } from '@/lib/types'
import { pageHref, str } from '@/lib/url'
import { AccountButton, TransactionButton } from '../FinanceForms'
import { FinanceTabs, MonthNav } from '../FinanceNav'
import { TxTable } from '../TxList'

export const metadata: Metadata = { title: 'Transaksi' }

const PER_PAGE = 30

export default async function Page({ searchParams }: PageProps<'/keuangan/transaksi'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const month = /^\d{4}-\d{2}$/.test(str(sp.bulan)) ? str(sp.bulan) : today.slice(0, 7)
  const r = monthRange(month)
  const jenis = ['pemasukan', 'pengeluaran', 'transfer'].includes(str(sp.jenis)) ? str(sp.jenis) : ''
  const rekening = str(sp.rekening)
  const kategori = str(sp.kategori)
  const q = str(sp.q).replace(/[%_\\,()]/g, ' ').trim().slice(0, 100)
  const page = Math.max(1, Number.parseInt(str(sp.hal) || '1', 10) || 1)
  const supabase = await createClient()

  let query = supabase.from('transactions').select(TX_COLS).gte('occurred_on', r.from).lt('occurred_on', r.to)
  if (jenis === 'transfer') query = query.in('type', ['transfer_keluar', 'transfer_masuk'])
  else if (jenis) query = query.eq('type', jenis)
  if (kategori) query = query.eq('category_id', kategori)
  if (q) query = query.ilike('note', `%${q}%`)
  const [accounts, allAccounts, categories, { data }] = await Promise.all([
    loadAccounts(supabase),
    loadAccounts(supabase, true),
    loadCategories(supabase),
    query.order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(5000),
  ])
  let rows = toRows((data ?? []) as Transaction[])
  // Filter rekening setelah transfer digabung → transfer tampil bila rekening jadi asal ATAU tujuan.
  if (rekening) rows = rows.filter((t) => t.account_id === rekening || t.to_account_id === rekening)
  const flow = sumFlow(rows.map((t) => ({ type: t.kind === 'transfer' ? 'transfer_keluar' : t.kind, amount: t.amount })) as Transaction[])
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const label = monthLabel(month)
  const filtered = !!(jenis || rekening || kategori || q)

  return (
    <div className="page">
      <PageHead title="Keuangan" description="Rekening, pemasukan, pengeluaran, transfer, dan anggaran — saldo dihitung dari transaksi."
        actions={accounts.length ? <TransactionButton accounts={accounts} categories={categories} today={today} /> : <AccountButton />} />
      <FinanceTabs />

      <section className="card" aria-labelledby="tx-title">
        <SectionHead id="tx-title" icon={<Receipt size={18} />} title="Transaksi" desc={<>Bulan <span className="capitalize">{label}</span> · transfer digabung menjadi satu baris</>}>
          <MonthNav base="/keuangan/transaksi" label={label} prev={r.prev} next={r.next} isCurrent={month === today.slice(0, 7)} />
        </SectionHead>
        <FilterBar>
          <SearchParamInput label="Cari transaksi" placeholder="Cari catatan transaksi" />
          <ParamSelect param="jenis" label="Jenis" options={[{ value: '', label: 'Semua jenis' }, { value: 'pemasukan', label: 'Pemasukan' }, { value: 'pengeluaran', label: 'Pengeluaran' }, { value: 'transfer', label: 'Transfer' }]} />
          <ParamSelect param="rekening" label="Rekening" options={[{ value: '', label: 'Semua rekening' }, ...allAccounts.map((a) => ({ value: a.id, label: a.name }))]} />
          <ParamSelect param="kategori" label="Kategori" options={[{ value: '', label: 'Semua kategori' }, ...categories.map((c) => ({ value: c.id, label: `${c.name} (${c.type === 'pemasukan' ? 'masuk' : 'keluar'})` }))]} />
        </FilterBar>
        {shown.length === 0 ? (
          <EmptyState icon={<Receipt size={20} strokeWidth={1.75} />} title={filtered ? 'Tidak ada yang cocok' : 'Belum ada transaksi bulan ini'}
            description={filtered ? 'Coba ubah saringan atau bulan.' : 'Catat pemasukan, pengeluaran, atau transfer.'}
            action={!filtered && accounts.length ? <TransactionButton accounts={accounts} categories={categories} today={today} /> : undefined} />
        ) : (
          <>
            <TxTable rows={shown} accounts={accounts} categories={categories} allAccounts={allAccounts} />
            <nav className="card-foot" aria-label="Paginasi">
              <p className="text-caption">
                <strong>{formatNumber(total)}</strong> transaksi · Masuk <strong style={{ color: 'var(--brand-ink)' }}>{formatRupiah(flow.income)}</strong> · Keluar <strong>{formatRupiah(flow.expense)}</strong>
              </p>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  {page > 1 ? <Link className="btn btn-secondary btn-sm btn-icon" aria-label="Halaman sebelumnya" href={pageHref('/keuangan/transaksi', sp, page - 1)}><ChevronLeft size={16} /></Link>
                    : <span className="btn btn-secondary btn-sm btn-icon" aria-disabled="true"><ChevronLeft size={16} /></span>}
                  <span className="text-label font-normal">Halaman {page} / {pages}</span>
                  {page < pages ? <Link className="btn btn-secondary btn-sm btn-icon" aria-label="Halaman berikutnya" href={pageHref('/keuangan/transaksi', sp, page + 1)}><ChevronRight size={16} /></Link>
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
