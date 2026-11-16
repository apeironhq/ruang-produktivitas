import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Landmark, LineChart, PieChart, PiggyBank, Receipt, Scale, Wallet } from 'lucide-react'
import { TrendChart } from '@/components/ui/charts'
import { DonutChart, EmptyState, KpiCard, PageHead, ProgressBar, tint } from '@/components/ui/display'
import { dayRange, todayIn } from '@/lib/dates'
import { TX_COLS, loadAccounts, loadCategories, monthLabel, monthRange, sumFlow, toRows } from '@/lib/finance'
import { formatDay, formatNumber, formatRupiah } from '@/lib/format'
import { ACCOUNT_KIND } from '@/lib/labels'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Budget, Transaction } from '@/lib/types'
import { str } from '@/lib/url'
import { AccountButton, TransactionButton } from './FinanceForms'
import { FinanceTabs, MonthNav } from './FinanceNav'
import { TxAmount, txTitle } from './TxList'

export const metadata: Metadata = { title: 'Keuangan' }

const PALETTE = ['#d4547e', '#b85c22', '#6a53b8', '#2563eb', '#0e9384', '#98a2b3']

export default async function Page({ searchParams }: PageProps<'/keuangan'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const month = /^\d{4}-\d{2}$/.test(str(sp.bulan)) ? str(sp.bulan) : today.slice(0, 7)
  const r = monthRange(month)
  const prevR = monthRange(r.prev)
  const supabase = await createClient()

  const [accounts, categories, txRes, prevRes, budgetRes, recentRes] = await Promise.all([
    loadAccounts(supabase),
    loadCategories(supabase),
    supabase.from('transactions').select(TX_COLS).gte('occurred_on', r.from).lt('occurred_on', r.to).limit(5000),
    supabase.from('transactions').select('type, amount').gte('occurred_on', prevR.from).lt('occurred_on', prevR.to).in('type', ['pemasukan', 'pengeluaran']).limit(5000),
    supabase.from('budgets').select('id, category_id, month, limit_amount').eq('month', r.from),
    supabase.from('transactions').select(TX_COLS).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(16),
  ])
  const txs = (txRes.data ?? []) as Transaction[]
  const flow = sumFlow(txs)
  const prev = sumFlow((prevRes.data ?? []) as Transaction[])
  const totalBalance = accounts.reduce((n, a) => n + a.balance, 0)
  const totalAllocated = accounts.reduce((n, a) => n + a.allocated, 0)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const accName = new Map(accounts.map((a) => [a.id, a.name]))

  // Pengeluaran per hari (sampai hari ini untuk bulan berjalan)
  const lastDay = month === today.slice(0, 7) ? today : r.last
  const days = dayRange(r.from, lastDay < r.from ? r.from : lastDay)
  const perDay = new Map(days.map((d) => [d, 0]))
  for (const t of txs) if (t.type === 'pengeluaran' && perDay.has(t.occurred_on)) perDay.set(t.occurred_on, perDay.get(t.occurred_on)! + Number(t.amount))
  const trend = days.map((d) => ({ date: d, value: Math.round(perDay.get(d) ?? 0) }))

  // Pengeluaran per kategori (5 terbesar + lainnya)
  const byCat = new Map<string, number>()
  for (const t of txs) if (t.type === 'pengeluaran') byCat.set(t.category_id ?? '-', (byCat.get(t.category_id ?? '-') ?? 0) + Number(t.amount))
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const segments = sorted.slice(0, 5).map(([id, v], i) => ({ label: id === '-' ? 'Tanpa kategori' : catName.get(id) ?? 'Lainnya', value: Math.round(v), color: PALETTE[i]! }))
  const rest = sorted.slice(5).reduce((n, [, v]) => n + v, 0)
  if (rest > 0) segments.push({ label: 'Lainnya', value: Math.round(rest), color: PALETTE[5]! })

  const budgets = ((budgetRes.data ?? []) as Budget[]).map((b) => ({ ...b, limit: Number(b.limit_amount), spent: byCat.get(b.category_id) ?? 0 }))
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
  const recent = toRows((recentRes.data ?? []) as Transaction[]).slice(0, 8)
  const label = monthLabel(month)
  const caption = (now: number, before: number) => before ? `Bulan lalu ${formatRupiah(before)}` : 'Bulan lalu belum ada data'

  return (
    <div className="page">
      <PageHead title="Keuangan" description="Rekening, pemasukan, pengeluaran, transfer, dan anggaran — saldo dihitung dari transaksi."
        actions={accounts.length ? <TransactionButton accounts={accounts} categories={categories} today={today} /> : <AccountButton />} />
      <FinanceTabs />

      {accounts.length === 0 ? (
        <section className="card">
          <EmptyState icon={<Landmark size={20} strokeWidth={1.75} />} title="Mulai dengan menambahkan rekening"
            description="Tambahkan tunai, rekening bank, atau dompet digital beserta saldo awalnya. Setelah itu catat pemasukan, pengeluaran, dan transfer."
            action={<AccountButton />} />
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-caption">Ringkasan arus kas bulan <span className="capitalize">{label}</span>. Transfer antarrekening tidak dihitung.</p>
            <MonthNav base="/keuangan" label={label} prev={r.prev} next={r.next} isCurrent={month === today.slice(0, 7)} />
          </div>

          <div className="kpis kpis-4">
            <KpiCard label="Total saldo" value={null} display={formatRupiah(totalBalance)} icon={<Wallet size={20} strokeWidth={1.9} />} color="var(--c-blue)" href="/keuangan/rekening"
              caption={`${accounts.length} rekening${totalAllocated ? ` · ${formatRupiah(totalAllocated)} teralokasi` : ''}`} />
            <KpiCard label="Pemasukan" value={null} display={formatRupiah(flow.income)} icon={<ArrowDownLeft size={20} strokeWidth={1.9} />} color="var(--c-lilac)" href={`/keuangan/transaksi?bulan=${month}&jenis=pemasukan`}
              caption={caption(flow.income, prev.income)} />
            <KpiCard label="Pengeluaran" value={null} display={formatRupiah(flow.expense)} icon={<ArrowUpRight size={20} strokeWidth={1.9} />} color="var(--c-rose)" href={`/keuangan/transaksi?bulan=${month}&jenis=pengeluaran`}
              caption={caption(flow.expense, prev.expense)} />
            <KpiCard label="Selisih (arus kas)" value={null} display={`${flow.net < 0 ? '−' : ''}${formatRupiah(Math.abs(flow.net))}`} icon={<Scale size={20} strokeWidth={1.9} />} color="var(--c-peach)"
              caption={flow.net >= 0 ? 'Pemasukan lebih besar' : 'Pengeluaran lebih besar'} />
          </div>

          <div className="row-2">
            <section className="card panel" aria-labelledby="trend-title">
              <div className="panel-head"><div><h2 id="trend-title"><LineChart size={18} />Pengeluaran harian</h2><p className="text-caption">Total {formatRupiah(flow.expense)} di bulan <span className="capitalize">{label}</span></p></div></div>
              <div className="panel-body"><TrendChart points={trend} label="Pengeluaran" unit="rupiah" color="#d4547e" /></div>
            </section>
            <section className="card panel" aria-labelledby="cat-title">
              <div className="panel-head"><div><h2 id="cat-title"><PieChart size={18} />Pengeluaran per kategori</h2><p className="text-caption">Lima kategori terbesar</p></div></div>
              <div className="panel-body center">
                {segments.length ? <DonutChart segments={segments} centerLabel="Pengeluaran" /> : <EmptyState title="Belum ada pengeluaran" description="Pengeluaran bulan ini akan dikelompokkan per kategori." className="fill" />}
              </div>
            </section>
          </div>

          <div className="row-3">
            <section className="card panel" aria-labelledby="recent-title">
              <div className="panel-head"><div><h2 id="recent-title"><Receipt size={18} />Transaksi terbaru</h2><p className="text-caption">Semua rekening</p></div><Link href="/keuangan/transaksi" className="link-sm">Lihat semua</Link></div>
              <div className="panel-body">
                {recent.length === 0 ? <EmptyState title="Belum ada transaksi" description="Catat pemasukan atau pengeluaran pertama Anda." className="fill" /> : (
                  <ul className="items">{recent.map((t) => (
                    <li key={t.id} className="item">
                      <span className="min-w-0 flex-1">
                        <span className="item-title block truncate">{txTitle(t, catName, accName)}</span>
                        <span className="item-sub block truncate">{formatDay(t.occurred_on)} · {accName.get(t.account_id)}</span>
                      </span>
                      <TxAmount r={t} />
                    </li>
                  ))}</ul>
                )}
              </div>
            </section>

            <section className="card panel" aria-labelledby="budget-title">
              <div className="panel-head"><div><h2 id="budget-title"><PiggyBank size={18} />Anggaran</h2><p className="text-caption">Terpakai bulan <span className="capitalize">{label}</span></p></div><Link href={`/keuangan/anggaran?bulan=${month}`} className="link-sm">Atur</Link></div>
              <div className="panel-body">
                {budgets.length === 0 ? <EmptyState title="Belum ada anggaran" description="Tetapkan batas pengeluaran per kategori agar mudah dikendalikan." className="fill" action={<Link href={`/keuangan/anggaran?bulan=${month}`} className="btn btn-secondary btn-sm">Atur anggaran</Link>} /> : (
                  <ul className="items">{budgets.map((b) => {
                    const pct = (b.spent / b.limit) * 100
                    return (
                      <li key={b.id} className="item">
                        <span className="min-w-0 flex-1">
                          <span className="item-row"><span className="item-title truncate">{catName.get(b.category_id)}</span><span className="item-meta">{formatNumber(Math.floor(pct))}%</span></span>
                          <ProgressBar percent={pct} label={`Anggaran ${catName.get(b.category_id)}`} color={pct > 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : undefined} />
                          <span className="item-sub block truncate">{formatRupiah(b.spent)} dari {formatRupiah(b.limit)}</span>
                        </span>
                      </li>
                    )
                  })}</ul>
                )}
              </div>
            </section>

            <section className="card panel" aria-labelledby="acc-title">
              <div className="panel-head"><div><h2 id="acc-title"><Landmark size={18} />Rekening</h2><p className="text-caption">Saldo saat ini</p></div><Link href="/keuangan/rekening" className="link-sm">Kelola</Link></div>
              <div className="panel-body">
                <ul className="items">{accounts.map((a) => (
                  <li key={a.id} className="item">
                    <span className="act-icon" style={tint('var(--c-blue)')} aria-hidden="true"><Landmark size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="item-title block truncate">{a.name}</span>
                      <span className="item-sub block truncate">{ACCOUNT_KIND[a.kind]}{a.allocated ? ` · ${formatRupiah(a.allocated)} untuk target` : ''}</span>
                    </span>
                    <span className="cell-strong whitespace-nowrap" style={{ color: a.balance < 0 ? 'var(--err)' : 'var(--text-heading)' }}>{formatRupiah(a.balance)}</span>
                  </li>
                ))}</ul>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
