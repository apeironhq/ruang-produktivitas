'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zDay, zEnum, zNumber, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { createClient } from '@/lib/supabase/server'

function revalidateFinance() {
  revalidatePath('/keuangan', 'layout')
  revalidatePath('/')
}

const zMoney = (label = 'Nominal') => zNumber(label).refine((n) => n > 0, `${label} harus lebih dari 0.`).refine((n) => Math.round(n * 100) === n * 100, `${label} maksimal 2 angka desimal.`)

// ---------- Rekening ----------
export async function saveAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    id: zOptUuid,
    name: zText(80, 'Nama rekening'),
    kind: zEnum(['tunai', 'bank', 'dompet_digital', 'lainnya'] as const, 'Jenis'),
    opening_balance: z.preprocess((v) => (v === '' || v == null ? '0' : v), zNumber('Saldo awal')),
  }), formData)
  if (parsed.error) return parsed.error
  const { id, ...row } = parsed.data
  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('financial_accounts').update(row).eq('id', id)
    : await supabase.from('financial_accounts').insert(row)
  if (error) return dbError(error)
  revalidateFinance()
  return ok(id ? 'Rekening diperbarui.' : 'Rekening ditambahkan.')
}

export async function setAccountArchived(id: string, archived: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('financial_accounts').update({ is_archived: archived }).eq('id', id)
  if (error) return dbError(error)
  revalidateFinance()
  return ok(archived ? 'Rekening diarsipkan.' : 'Rekening diaktifkan kembali.')
}

export async function deleteAccount(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', id)
  if (count) return fail(`Rekening masih punya ${count} transaksi. Arsipkan saja agar riwayat tetap utuh.`)
  const { error } = await supabase.from('financial_accounts').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateFinance()
  return ok('Rekening dihapus.')
}

// ---------- Transaksi ----------
const txSchema = z.object({
  id: zOptUuid,
  group_id: zOptUuid,
  kind: zEnum(['pemasukan', 'pengeluaran', 'transfer'] as const, 'Jenis'),
  amount: zMoney(),
  account_id: zUuid,
  to_account_id: zOptUuid,
  category_id: zOptUuid,
  occurred_on: zDay,
  note: zOptText(500),
}).superRefine((v, ctx) => {
  if (v.kind === 'transfer') {
    if (!v.to_account_id) ctx.addIssue({ code: 'custom', path: ['to_account_id'], message: 'Pilih rekening tujuan.' })
    else if (v.to_account_id === v.account_id) ctx.addIssue({ code: 'custom', path: ['to_account_id'], message: 'Rekening tujuan harus berbeda.' })
  }
})

export async function saveTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(txSchema, formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const supabase = await createClient()

  if (v.kind === 'transfer') {
    // Mengubah transaksi biasa menjadi transfer: hapus baris lama lebih dulu.
    if (v.id && !v.group_id) {
      const { error } = await supabase.from('transactions').delete().eq('id', v.id)
      if (error) return dbError(error)
    }
    const { error } = await supabase.rpc('save_transfer', {
      p_group: v.group_id, p_from: v.account_id, p_to: v.to_account_id, p_amount: v.amount, p_date: v.occurred_on, p_note: v.note,
    })
    if (error) return dbError(error)
    revalidateFinance()
    return ok(v.group_id ? 'Transfer diperbarui.' : 'Transfer dicatat.')
  }

  const row = { account_id: v.account_id, type: v.kind, amount: v.amount, category_id: v.category_id, occurred_on: v.occurred_on, note: v.note }
  if (v.group_id) {
    // Mengubah transfer menjadi transaksi biasa: hapus pasangan transfer, lalu buat baru.
    const { error } = await supabase.from('transactions').delete().eq('transfer_group_id', v.group_id)
    if (error) return dbError(error)
  }
  const { error } = v.id && !v.group_id
    ? await supabase.from('transactions').update(row).eq('id', v.id)
    : await supabase.from('transactions').insert(row)
  if (error) return dbError(error)
  revalidateFinance()
  return ok(v.id ? 'Transaksi diperbarui.' : v.kind === 'pemasukan' ? 'Pemasukan dicatat.' : 'Pengeluaran dicatat.')
}

export async function deleteTransaction(id: string, groupId: string | null): Promise<ActionState> {
  const supabase = await createClient()
  const q = groupId && zUuid.safeParse(groupId).success
    ? supabase.from('transactions').delete().eq('transfer_group_id', groupId)
    : zUuid.safeParse(id).success ? supabase.from('transactions').delete().eq('id', id) : null
  if (!q) return fail('Data tidak valid.')
  const { error } = await q
  if (error) return dbError(error)
  revalidateFinance()
  return ok(groupId ? 'Transfer dihapus.' : 'Transaksi dihapus.')
}

// ---------- Kategori ----------
export async function saveCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ name: zText(60, 'Nama kategori'), type: zEnum(['pemasukan', 'pengeluaran'] as const, 'Jenis') }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { error } = await supabase.from('transaction_categories').insert(parsed.data)
  if (error?.code === '23505') return fail('Periksa kembali isian yang ditandai.', { name: 'Kategori dengan nama ini sudah ada.' })
  if (error) return dbError(error)
  revalidateFinance()
  return ok('Kategori ditambahkan.')
}

export async function deleteCategory(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('transaction_categories').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateFinance()
  return ok('Kategori dihapus. Transaksi lamanya kini tanpa kategori.')
}

// ---------- Anggaran ----------
export async function saveBudget(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    category_id: zUuid,
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Bulan tidak valid.'),
    limit_amount: zMoney('Batas anggaran'),
  }), formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.from('budgets').upsert(
    { category_id: v.category_id, month: `${v.month}-01`, limit_amount: v.limit_amount },
    { onConflict: 'user_id,category_id,month' },
  )
  if (error) return dbError(error)
  revalidateFinance()
  return ok('Anggaran disimpan.')
}

export async function deleteBudget(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateFinance()
  return ok('Anggaran dihapus.')
}

/** Salin semua anggaran bulan sebelumnya ke bulan ini (yang belum ada). */
export async function copyBudgets(fromMonth: string, toMonth: string): Promise<ActionState> {
  if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) return fail('Bulan tidak valid.')
  const supabase = await createClient()
  const { data } = await supabase.from('budgets').select('category_id, limit_amount').eq('month', `${fromMonth}-01`)
  if (!data?.length) return fail('Bulan sebelumnya belum punya anggaran.')
  const { error } = await supabase.from('budgets').upsert(
    data.map((b) => ({ category_id: b.category_id, month: `${toMonth}-01`, limit_amount: b.limit_amount })),
    { onConflict: 'user_id,category_id,month', ignoreDuplicates: true },
  )
  if (error) return dbError(error)
  revalidateFinance()
  return ok(`${data.length} anggaran disalin dari bulan lalu.`)
}

// ---------- Alokasi ke target tabungan ----------
export async function saveAllocation(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    goal_id: zUuid,
    account_id: zUuid,
    mode: zEnum(['alokasi', 'tarik'] as const),
    amount: zMoney('Jumlah'),
    occurred_on: zDay,
    note: zOptText(500),
  }), formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const supabase = await createClient()
  if (v.mode === 'alokasi') {
    const { data: bal } = await supabase.from('account_balances').select('balance, allocated').eq('account_id', v.account_id).maybeSingle()
    const free = Number(bal?.balance ?? 0) - Number(bal?.allocated ?? 0)
    if (v.amount > free) return fail('Periksa kembali isian yang ditandai.', { amount: `Melebihi dana bebas rekening ini (${new Intl.NumberFormat('id-ID').format(Math.max(0, free))}).` })
  } else {
    const { data: rows } = await supabase.from('goal_allocations').select('amount').eq('goal_id', v.goal_id).eq('account_id', v.account_id)
    const held = (rows ?? []).reduce((n, r) => n + Number(r.amount), 0)
    if (v.amount > held) return fail('Periksa kembali isian yang ditandai.', { amount: `Dana target di rekening ini hanya ${new Intl.NumberFormat('id-ID').format(Math.max(0, held))}.` })
  }
  const { data: goal } = await supabase.from('goals').select('progress_source').eq('id', v.goal_id).maybeSingle()
  if (goal?.progress_source !== 'alokasi') return fail('Target ini tidak memakai alokasi tabungan.')
  const { error } = await supabase.from('goal_allocations').insert({
    goal_id: v.goal_id, account_id: v.account_id, amount: v.mode === 'tarik' ? -v.amount : v.amount, occurred_on: v.occurred_on, note: v.note,
  })
  if (error) return dbError(error)
  revalidateFinance()
  revalidatePath('/target', 'layout')
  revalidatePath('/pencapaian')
  return ok(v.mode === 'tarik' ? 'Dana ditarik dari target.' : 'Dana dialokasikan ke target.')
}

export async function deleteAllocation(id: string, goalId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goal_allocations').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateFinance()
  revalidatePath(`/target/${goalId}`)
  revalidatePath('/target')
  return ok('Alokasi dihapus.')
}
