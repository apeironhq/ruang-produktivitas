import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from './dates'
import type { AccountWithBalance, Account, Category, Transaction } from './types'

/** Rekening + saldo (view account_balances) dalam satu putaran paralel. */
export async function loadAccounts(supabase: SupabaseClient, includeArchived = false): Promise<AccountWithBalance[]> {
  let q = supabase.from('financial_accounts').select('id, name, kind, opening_balance, is_archived, created_at').order('created_at')
  if (!includeArchived) q = q.eq('is_archived', false)
  const [{ data: accounts }, { data: balances }] = await Promise.all([
    q,
    supabase.from('account_balances').select('account_id, balance, allocated'),
  ])
  const map = new Map((balances ?? []).map((b) => [b.account_id as string, b]))
  return ((accounts ?? []) as Account[]).map((a) => ({
    ...a,
    opening_balance: Number(a.opening_balance),
    balance: Number(map.get(a.id)?.balance ?? a.opening_balance),
    allocated: Number(map.get(a.id)?.allocated ?? 0),
  }))
}

export async function loadCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data } = await supabase.from('transaction_categories').select('id, name, type').order('type').order('name')
  return (data ?? []) as Category[]
}

/** "YYYY-MM" → batas [awal, awal bulan berikutnya). */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`
  const prev = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
  return { from, to: next, last: addDays(next, -1), prev, next: next.slice(0, 7) }
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))
}

/** Baris tampilan: transfer (2 mutasi) digabung menjadi satu baris "A → B". */
export interface TxRow {
  id: string
  kind: 'pemasukan' | 'pengeluaran' | 'transfer'
  amount: number
  occurred_on: string
  note: string
  category_id: string | null
  account_id: string
  to_account_id: string | null
  transfer_group_id: string | null
  created_at: string
}

export function toRows(txs: Transaction[]): TxRow[] {
  const rows: TxRow[] = []
  const pairs = new Map<string, Transaction>()
  for (const t of txs) if (t.type === 'transfer_masuk' && t.transfer_group_id) pairs.set(t.transfer_group_id, t)
  for (const t of txs) {
    if (t.type === 'transfer_masuk') continue
    const isTransfer = t.type === 'transfer_keluar'
    rows.push({
      id: t.id,
      kind: isTransfer ? 'transfer' : t.type as 'pemasukan' | 'pengeluaran',
      amount: Number(t.amount),
      occurred_on: t.occurred_on,
      note: t.note,
      category_id: t.category_id,
      account_id: t.account_id,
      to_account_id: isTransfer && t.transfer_group_id ? pairs.get(t.transfer_group_id)?.account_id ?? null : null,
      transfer_group_id: t.transfer_group_id,
      created_at: t.created_at,
    })
  }
  return rows
}

/** Ringkasan arus kas: transfer TIDAK dihitung sebagai pemasukan/pengeluaran (PRD §6.7). */
export function sumFlow(txs: Pick<Transaction, 'type' | 'amount'>[]) {
  let income = 0, expense = 0
  for (const t of txs) {
    if (t.type === 'pemasukan') income += Number(t.amount)
    else if (t.type === 'pengeluaran') expense += Number(t.amount)
  }
  return { income, expense, net: income - expense }
}

export const TX_COLS = 'id, account_id, type, amount, category_id, occurred_on, note, transfer_group_id, created_at'
