import type { Metadata } from 'next'
import { Copy, Rabbit, Tags, Trash2 } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { EmptyState, KpiCard, PageHead, ProgressBar, SectionHead } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { loadAccounts, loadCategories, monthLabel, monthRange } from '@/lib/finance'
import { formatNumber, formatRupiah } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Budget } from '@/lib/types'
import { str } from '@/lib/url'
import { copyBudgets, deleteBudget, deleteCategory } from '../actions'
import { AccountButton, BudgetButton, CategoryButton, TransactionButton } from '../FinanceForms'
import { FinanceTabs, MonthNav } from '../FinanceNav'

export const metadata: Metadata = { title: 'Anggaran' }

export default async function Page({ searchParams }: PageProps<'/keuangan/anggaran'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const month = /^\d{4}-\d{2}$/.test(str(sp.bulan)) ? str(sp.bulan) : today.slice(0, 7)
  const r = monthRange(month)
  const supabase = await createClient()
  const [accounts, categories, budgetRes, spendRes, prevBudgets] = await Promise.all([
    loadAccounts(supabase),
    loadCategories(supabase),
    supabase.from('budgets').select('id, category_id, month, limit_amount').eq('month', r.from),
    supabase.from('transactions').select('category_id, amount').eq('type', 'pengeluaran').gte('occurred_on', r.from).lt('occurred_on', r.to).limit(5000),
    supabase.from('budgets').select('id', { count: 'exact', head: true }).eq('month', `${r.prev}-01`),
  ])
  const spent = new Map<string, number>()
  for (const t of spendRes.data ?? []) if (t.category_id) spent.set(t.category_id, (spent.get(t.category_id) ?? 0) + Number(t.amount))
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const budgets = ((budgetRes.data ?? []) as Budget[])
    .map((b) => ({ ...b, limit: Number(b.limit_amount), spent: spent.get(b.category_id) ?? 0 }))
    .sort((a, b) => (catName.get(a.category_id) ?? '').localeCompare(catName.get(b.category_id) ?? ''))
  const totalLimit = budgets.reduce((n, b) => n + b.limit, 0)
  const totalSpent = budgets.reduce((n, b) => n + b.spent, 0)
  const over = budgets.filter((b) => b.spent > b.limit).length
  const unbudgeted = [...spent.entries()].filter(([id]) => !budgets.some((b) => b.category_id === id))
  const label = monthLabel(month)

  return (
    <div className="page">
      <PageHead title="Keuangan" description="Rekening, pemasukan, pengeluaran, transfer, dan anggaran — saldo dihitung dari transaksi."
        actions={accounts.length ? <TransactionButton accounts={accounts} categories={categories} today={today} /> : <AccountButton />} />
      <FinanceTabs />

      <div className="kpis kpis-3">
        <KpiCard label="Total anggaran" value={null} display={formatRupiah(totalLimit)} icon={<Rabbit size={20} strokeWidth={1.9} />} color="var(--c-blue)" caption={`${budgets.length} kategori`} />
        <KpiCard label="Terpakai" value={null} display={formatRupiah(totalSpent)} icon={<Rabbit size={20} strokeWidth={1.9} />} color="var(--c-rose)"
          progress={totalLimit ? (totalSpent / totalLimit) * 100 : undefined} progressColor={totalSpent > totalLimit ? 'var(--err)' : totalSpent >= totalLimit * 0.8 ? 'var(--p-amber)' : 'var(--ok)'}
          caption={totalLimit ? `${formatNumber(Math.floor((totalSpent / totalLimit) * 100))}% dari total anggaran` : 'Belum ada anggaran'} />
        <KpiCard label="Sisa" value={null} display={`${totalLimit - totalSpent < 0 ? '−' : ''}${formatRupiah(Math.abs(totalLimit - totalSpent))}`} icon={<Rabbit size={20} strokeWidth={1.9} />} color="var(--c-peach)"
          progress={totalLimit ? Math.max(0, ((totalLimit - totalSpent) / totalLimit) * 100) : undefined}
          caption={over ? `${over} kategori melewati batas` : 'Semua kategori masih di bawah batas'} />
      </div>

      <section className="card" aria-labelledby="bud-title">
        <SectionHead id="bud-title" icon={<Rabbit size={18} />} title="Anggaran per kategori" desc={<>Batas pengeluaran bulan <span className="capitalize">{label}</span></>}>
          <MonthNav base="/keuangan/anggaran" label={label} prev={r.prev} next={r.next} isCurrent={month === today.slice(0, 7)} />
          <BudgetButton categories={categories} month={month} monthLabel={label} className="btn btn-primary btn-sm" />
        </SectionHead>
        {budgets.length === 0 ? (
          <EmptyState icon={<Rabbit size={20} strokeWidth={1.75} />} title="Belum ada anggaran bulan ini"
            description="Tetapkan batas pengeluaran per kategori, mis. Makan & minum Rp1.500.000."
            action={<div className="flex gap-2 flex-wrap justify-center">
              <BudgetButton categories={categories} month={month} monthLabel={label} />
              {(prevBudgets.count ?? 0) > 0 && <ActionButton action={copyBudgets.bind(null, r.prev, month)}><Copy size={16} />Salin dari bulan lalu</ActionButton>}
            </div>} />
        ) : (
          <ul className="items">
            {budgets.map((b) => {
              const pct = (b.spent / b.limit) * 100
              const left = b.limit - b.spent
              return (
                <li key={b.id} className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="item-row">
                      <span className="item-title truncate">{catName.get(b.category_id) ?? 'Kategori dihapus'}</span>
                      <span className="item-meta" style={{ color: pct > 100 ? 'var(--err)' : undefined }}>{formatNumber(Math.floor(pct))}%</span>
                    </div>
                    <ProgressBar percent={pct} label={`Anggaran ${catName.get(b.category_id)}`} color={pct > 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : undefined} />
                    <span className="item-sub">
                      {formatRupiah(b.spent)} dari {formatRupiah(b.limit)} · {left >= 0 ? `sisa ${formatRupiah(left)}` : <span className="overdue">lewat {formatRupiah(-left)}</span>}
                    </span>
                  </div>
                  <BudgetButton categories={categories} month={month} monthLabel={label} preset={{ category_id: b.category_id, limit_amount: b.limit }} />
                  <ConfirmButton action={deleteBudget.bind(null, b.id)} title="Hapus anggaran?" message={`Anggaran ${catName.get(b.category_id)} untuk ${label} dihapus. Transaksinya tidak terpengaruh.`}
                    className="btn btn-ghost btn-sm btn-icon" ariaLabel="Hapus anggaran"><Trash2 size={15} /></ConfirmButton>
                </li>
              )
            })}
          </ul>
        )}
        {unbudgeted.length > 0 && (
          <div className="card-foot">
            <p className="text-caption">Pengeluaran tanpa anggaran: {unbudgeted.map(([id, v]) => `${catName.get(id)} ${formatRupiah(v)}`).join(' · ')}</p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="cat-title">
        <SectionHead id="cat-title" icon={<Tags size={18} />} title="Kategori" desc="Dipakai untuk transaksi dan anggaran. Menghapus kategori tidak menghapus transaksinya.">
          <CategoryButton />
        </SectionHead>
        <div className="card-body grid gap-6 md:grid-cols-2">
          {(['pengeluaran', 'pemasukan'] as const).map((type) => (
            <div key={type}>
              <p className="text-overline mb-1">{type === 'pengeluaran' ? 'Pengeluaran' : 'Pemasukan'}</p>
              <ul className="items">
                {categories.filter((c) => c.type === type).map((c) => (
                  <li key={c.id} className="item">
                    <span className="item-title flex-1 min-w-0 truncate">{c.name}</span>
                    <ConfirmButton action={deleteCategory.bind(null, c.id)} title="Hapus kategori?" message={`Kategori "${c.name}" dihapus. Transaksi lamanya menjadi tanpa kategori dan anggarannya ikut terhapus.`}
                      className="btn btn-ghost btn-sm btn-icon" ariaLabel={`Hapus kategori ${c.name}`}><Trash2 size={15} /></ConfirmButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
