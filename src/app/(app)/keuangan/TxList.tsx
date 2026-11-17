import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ui/actions'
import { formatDay, formatRupiah } from '@/lib/format'
import type { TxRow } from '@/lib/finance'
import type { AccountWithBalance, Category } from '@/lib/types'
import { deleteTransaction } from './actions'
import { EditTransactionButton } from './FinanceForms'

const ICON = {
  pemasukan: { icon: <ArrowDownLeft size={16} />, color: 'var(--ok)' },
  pengeluaran: { icon: <ArrowUpRight size={16} />, color: 'var(--err)' },
  transfer: { icon: <ArrowLeftRight size={16} />, color: '#475467' },
}

export function txTitle(r: TxRow, cat: Map<string, string>, acc: Map<string, string>) {
  if (r.kind === 'transfer') return `Transfer ${acc.get(r.account_id) ?? '?'} → ${r.to_account_id ? acc.get(r.to_account_id) ?? '?' : '?'}`
  return r.note || (r.category_id ? cat.get(r.category_id) : null) || (r.kind === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran')
}

export function TxAmount({ r }: { r: TxRow }) {
  const sign = r.kind === 'pemasukan' ? '+' : r.kind === 'pengeluaran' ? '−' : ''
  return (
    <span className="cell-strong whitespace-nowrap" style={{ color: r.kind === 'pemasukan' ? 'var(--brand-ink)' : r.kind === 'transfer' ? 'var(--text-muted)' : 'var(--text-heading)' }}>
      {sign}{formatRupiah(r.amount)}
    </span>
  )
}

/** Tabel transaksi (table-stack: jadi kartu di layar sempit). */
export function TxTable({ rows, accounts, categories, allAccounts }: { rows: TxRow[]; accounts: AccountWithBalance[]; categories: Category[]; allAccounts: AccountWithBalance[] }) {
  const cat = new Map(categories.map((c) => [c.id, c.name]))
  const acc = new Map(allAccounts.map((a) => [a.id, a.name]))
  const actions = (r: TxRow) => (
    <>
      <EditTransactionButton accounts={accounts.length ? accounts : allAccounts} categories={categories} initial={{
        id: r.kind === 'transfer' ? undefined : r.id, group_id: r.transfer_group_id, kind: r.kind, amount: r.amount, account_id: r.account_id,
        to_account_id: r.to_account_id, category_id: r.category_id, occurred_on: r.occurred_on, note: r.note,
      }} />
      <ConfirmButton action={deleteTransaction.bind(null, r.id, r.transfer_group_id)} title={r.kind === 'transfer' ? 'Hapus transfer?' : 'Hapus transaksi?'}
        message={r.kind === 'transfer' ? 'Kedua mutasi transfer ini dihapus dan saldo kedua rekening dihitung ulang.' : 'Transaksi dihapus dan saldo rekening dihitung ulang.'}
        className="btn btn-ghost btn-sm btn-icon is-danger" ariaLabel="Hapus transaksi"><Trash2 size={15} /></ConfirmButton>
    </>
  )
  return (
    <div className="tx-wrap">
    {/* Ponsel: baris ringkas (ikon · keterangan · tanggal & rekening · nominal) */}
    <ul className="tx-list" aria-label="Daftar transaksi">
      {rows.map((r) => {
        const meta = [formatDay(r.occurred_on, { day: 'numeric', month: 'short' }), r.kind === 'transfer' ? 'Transfer' : r.note && r.category_id ? cat.get(r.category_id) : null, r.kind === 'transfer' ? null : acc.get(r.account_id)].filter(Boolean).join(' · ')
        return (
          <li key={r.id} className="tx-row">
            <span className="act-icon" style={{ color: ICON[r.kind].color, background: `color-mix(in srgb, ${ICON[r.kind].color} 10%, transparent)` }} aria-hidden="true">{ICON[r.kind].icon}</span>
            <span className="tx-main">
              <span className="item-title block truncate">{txTitle(r, cat, acc)}</span>
              <span className="item-sub block truncate">{meta}</span>
            </span>
            <span className="tx-side">
              <TxAmount r={r} />
              <span className="tx-acts">{actions(r)}</span>
            </span>
          </li>
        )
      })}
    </ul>
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabel transaksi">
      <table className="table table-stack">
        <thead>
          <tr><th scope="col">Keterangan</th><th scope="col">Tanggal</th><th scope="col">Kategori</th><th scope="col">Rekening</th><th scope="col" className="num">Nominal</th><th scope="col"><span className="sr-only">Aksi</span></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="cell-primary">
                <span className="flex items-center gap-3 min-w-0">
                  <span className="act-icon hidden sm:grid" style={{ color: ICON[r.kind].color, background: `color-mix(in srgb, ${ICON[r.kind].color} 10%, transparent)` }} aria-hidden="true">{ICON[r.kind].icon}</span>
                  <span className="min-w-0">
                    <span className="cell-strong block truncate">{txTitle(r, cat, acc)}</span>
                    {r.note && r.kind !== 'transfer' && r.category_id && <span className="item-sub block truncate">{cat.get(r.category_id)}</span>}
                    {r.kind === 'transfer' && r.note && <span className="item-sub block truncate">{r.note}</span>}
                  </span>
                </span>
              </td>
              <td data-label="Tanggal" className="whitespace-nowrap">{formatDay(r.occurred_on)}</td>
              <td data-label="Kategori">{r.kind === 'transfer' ? <span className="badge">Transfer</span> : r.category_id ? cat.get(r.category_id) : <span className="text-caption">—</span>}</td>
              <td data-label="Rekening">{acc.get(r.account_id) ?? '—'}</td>
              <td data-label="Nominal" className="num"><TxAmount r={r} /></td>
              <td data-label="" className="cell-actions">
                <div className="flex gap-1 justify-end">{actions(r)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  )
}
