'use client'

import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { ArrowLeftRight, Landmark, Pencil, Rabbit, Plus, Tags, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Choices, Field, FormModal, errClass } from '@/components/ui/forms'
import { ACCOUNT_KIND } from '@/lib/labels'
import type { AccountWithBalance, Category } from '@/lib/types'
import { saveAccount, saveAllocation, saveBudget, saveCategory, saveTransaction } from './actions'

const idNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const rp = (n: number) => `Rp${idNum.format(n)}`

/** Input nominal rupiah: menerima "500.000" atau "500000". */
function MoneyInput({ name, defaultValue, error, autoFocus }: { name: string; defaultValue?: number | null; error?: string; autoFocus?: boolean }) {
  return (
    <div className="input-affix">
      <span className="affix" aria-hidden="true">Rp</span>
      <input id={name} name={name} inputMode="decimal" autoComplete="off" autoFocus={autoFocus} className={`input input-rp${error ? ' has-error' : ''}`}
        defaultValue={defaultValue ? idNum.format(defaultValue) : ''} placeholder="0" required />
    </div>
  )
}

// =====================================================================
// Transaksi
// =====================================================================
export interface TxValues {
  id?: string
  group_id?: string | null
  kind: 'pemasukan' | 'pengeluaran' | 'transfer'
  amount: number | null
  account_id: string
  to_account_id: string | null
  category_id: string | null
  occurred_on: string
  note: string
}

export const emptyTx = (today: string, accounts: AccountWithBalance[], kind: TxValues['kind'] = 'pengeluaran'): TxValues => ({
  kind, amount: null, account_id: accounts[0]?.id ?? '', to_account_id: accounts[1]?.id ?? null, category_id: null, occurred_on: today, note: '',
})

export function TransactionFormModal({ open, onClose, initial, accounts, categories }: {
  open: boolean; onClose: () => void; initial: TxValues; accounts: AccountWithBalance[]; categories: Category[]
}) {
  const [kind, setKind] = useState(initial.kind)
  const editing = !!(initial.id || initial.group_id)
  const cats = categories.filter((c) => c.type === kind)
  return (
    <FormModal open={open} onClose={onClose} action={saveTransaction} icon={kind === 'transfer' ? <ArrowLeftRight size={18} /> : <Wallet size={18} />}
      title={editing ? 'Ubah transaksi' : 'Catat transaksi'}
      subtitle={kind === 'transfer' ? 'Pindah dana antarrekening — tidak dihitung sebagai pemasukan atau pengeluaran.' : 'Saldo rekening dihitung otomatis dari transaksi.'}
      submitLabel={editing ? 'Simpan perubahan' : 'Simpan'}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          {initial.group_id && <input type="hidden" name="group_id" value={initial.group_id} />}
          <Choices name="kind" label="Jenis" value={kind} onChange={(v) => setKind(v as TxValues['kind'])} columns={3} options={[
            { value: 'pengeluaran', title: 'Pengeluaran', desc: 'Uang keluar' },
            { value: 'pemasukan', title: 'Pemasukan', desc: 'Uang masuk' },
            { value: 'transfer', title: 'Transfer', desc: 'Antarrekening' },
          ]} />
          <div className="form-grid form-grid-2">
            <Field label="Nominal" name="amount" error={errors.amount}>
              <MoneyInput name="amount" defaultValue={initial.amount} error={errors.amount} />
            </Field>
            <Field label="Tanggal" name="occurred_on" error={errors.occurred_on}>
              <DateTimePicker id="occurred_on" name="occurred_on" mode="date" quick="past" defaultValue={initial.occurred_on} invalid={!!errors.occurred_on} required />
            </Field>
            <Field label={kind === 'transfer' ? 'Dari rekening' : 'Rekening'} name="account_id" error={errors.account_id}>
              <select id="account_id" name="account_id" className="select" defaultValue={initial.account_id}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {rp(a.balance)}</option>)}
              </select>
            </Field>
            {kind === 'transfer' ? (
              <Field label="Ke rekening" name="to_account_id" error={errors.to_account_id}>
                <select id="to_account_id" name="to_account_id" className={`select${errClass(errors, 'to_account_id')}`} defaultValue={initial.to_account_id ?? ''}>
                  <option value="">— Pilih —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Kategori" name="category_id" error={errors.category_id}>
                <select id="category_id" name="category_id" className="select" defaultValue={initial.kind === kind ? initial.category_id ?? '' : ''} key={kind}>
                  <option value="">— Tanpa kategori —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Catatan" name="note" hint="Opsional, mis. makan siang bersama tim">
            <input id="note" name="note" className="input" defaultValue={initial.note} maxLength={500} />
          </Field>
        </div>
      )}
    </FormModal>
  )
}

export function TransactionButton({ accounts, categories, today, kind, label = 'Catat transaksi', className = 'btn btn-primary' }: {
  accounts: AccountWithBalance[]; categories: Category[]; today: string; kind?: TxValues['kind']; label?: string; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  const none = accounts.length === 0
  return (
    <>
      <button type="button" className={className} disabled={none} title={none ? 'Tambahkan rekening terlebih dahulu' : undefined}
        onClick={() => { setKey((k) => k + 1); setOpen(true) }}><Plus size={16} />{label}</button>
      {open && <TransactionFormModal key={key} open onClose={() => setOpen(false)} initial={emptyTx(today, accounts, kind)} accounts={accounts} categories={categories} />}
    </>
  )
}

export function EditTransactionButton({ initial, accounts, categories }: { initial: TxValues; accounts: AccountWithBalance[]; categories: Category[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Ubah transaksi" onClick={() => setOpen(true)}><Pencil size={15} /></button>
      {open && <TransactionFormModal open onClose={() => setOpen(false)} initial={initial} accounts={accounts} categories={categories} />}
    </>
  )
}

// =====================================================================
// Rekening
// =====================================================================
export interface AccountValues { id?: string; name: string; kind: string; opening_balance: number }

export function AccountFormModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: AccountValues }) {
  const editing = !!initial.id
  return (
    <FormModal open={open} onClose={onClose} action={saveAccount} icon={<Landmark size={18} />}
      title={editing ? 'Ubah rekening' : 'Rekening baru'} subtitle="Tunai, rekening bank, atau dompet digital." submitLabel={editing ? 'Simpan perubahan' : 'Tambah rekening'}>
      {(errors) => (
        <div className="form-stack">
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <Field label="Nama" name="name" error={errors.name}>
            <input id="name" name="name" className={`input${errClass(errors, 'name')}`} defaultValue={initial.name} maxLength={80} required placeholder="Mis. BCA, Dompet, GoPay" />
          </Field>
          <Choices name="kind" label="Jenis" defaultValue={initial.kind} columns={2} options={Object.entries(ACCOUNT_KIND).map(([k, v]) => ({ value: k, title: v }))} />
          <Field label="Saldo awal" name="opening_balance" error={errors.opening_balance} hint="Saldo saat mulai dicatat di aplikasi. Selanjutnya saldo dihitung dari transaksi.">
            <div className="input-affix">
              <span className="affix" aria-hidden="true">Rp</span>
              <input id="opening_balance" name="opening_balance" inputMode="decimal" className={`input input-rp${errClass(errors, 'opening_balance')}`}
                defaultValue={initial.opening_balance ? idNum.format(initial.opening_balance) : '0'} />
            </div>
          </Field>
        </div>
      )}
    </FormModal>
  )
}

export function AccountButton({ initial, label = 'Rekening baru', className = 'btn btn-primary' }: { initial?: AccountValues; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {initial
        ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Pencil size={15} /><span className="btn-text">Ubah</span></button>
        : <button type="button" className={className} onClick={() => setOpen(true)}><Plus size={16} />{label}</button>}
      {open && <AccountFormModal open onClose={() => setOpen(false)} initial={initial ?? { name: '', kind: 'bank', opening_balance: 0 }} />}
    </>
  )
}

// =====================================================================
// Anggaran
// =====================================================================
export function BudgetButton({ categories, month, monthLabel, preset, label = 'Atur anggaran', className = 'btn btn-primary' }: {
  categories: Category[]; month: string; monthLabel: string; preset?: { category_id: string; limit_amount: number }; label?: string; className?: string
}) {
  const [open, setOpen] = useState(false)
  const cats = categories.filter((c) => c.type === 'pengeluaran')
  return (
    <>
      {preset
        ? <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Ubah anggaran" onClick={() => setOpen(true)}><Pencil size={15} /></button>
        : <button type="button" className={className} onClick={() => setOpen(true)}><Plus size={16} />{label}</button>}
      {open && (
        <FormModal open onClose={() => setOpen(false)} action={saveBudget} icon={<Rabbit size={18} />} size="sm"
          title={preset ? 'Ubah anggaran' : 'Atur anggaran'} subtitle={`Batas pengeluaran per kategori untuk ${monthLabel}.`} submitLabel="Simpan">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="month" value={month} />
              <Field label="Kategori pengeluaran" name="category_id" error={errors.category_id}>
                <select id="category_id" name="category_id" className="select" defaultValue={preset?.category_id ?? cats[0]?.id}>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Batas" name="limit_amount" error={errors.limit_amount} hint="Bila kategori sudah punya anggaran bulan ini, nilainya diganti.">
                <MoneyInput name="limit_amount" defaultValue={preset?.limit_amount} error={errors.limit_amount} />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

// =====================================================================
// Kategori
// =====================================================================
export function CategoryButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Plus size={15} />Kategori</button>
      {open && (
        <FormModal open onClose={() => setOpen(false)} action={saveCategory} icon={<Tags size={18} />} size="sm" title="Kategori baru" submitLabel="Tambah">
          {(errors) => (
            <div className="form-stack">
              <Choices name="type" label="Jenis" defaultValue="pengeluaran" options={[{ value: 'pengeluaran', title: 'Pengeluaran' }, { value: 'pemasukan', title: 'Pemasukan' }]} />
              <Field label="Nama" name="name" error={errors.name}>
                <input id="name" name="name" className={`input${errClass(errors, 'name')}`} maxLength={60} required placeholder="Mis. Kuota internet" />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}

// =====================================================================
// Alokasi dana ke target tabungan
// =====================================================================
export function AllocationButton({ goalId, accounts, today, held }: { goalId: string; accounts: AccountWithBalance[]; today: string; held: Record<string, number> }) {
  const [open, setOpen] = useState(false)
  const none = accounts.length === 0
  return (
    <>
      <button type="button" className="btn btn-primary" disabled={none} title={none ? 'Tambahkan rekening di menu Keuangan terlebih dahulu' : undefined} onClick={() => setOpen(true)}>
        <Plus size={16} />Alokasikan dana
      </button>
      {open && (
        <FormModal open onClose={() => setOpen(false)} action={saveAllocation} icon={<Rabbit size={18} />}
          title="Alokasi tabungan" subtitle="Dana tetap di rekening, hanya ditandai untuk target ini — bukan pemasukan baru." submitLabel="Simpan">
          {(errors) => (
            <div className="form-stack">
              <input type="hidden" name="goal_id" value={goalId} />
              <Choices name="mode" label="Jenis" options={[
                { value: 'alokasi', title: 'Alokasikan', desc: 'Sisihkan dana untuk target' },
                { value: 'tarik', title: 'Tarik kembali', desc: 'Lepas dana dari target' },
              ]} />
              <Field label="Rekening" name="account_id" error={errors.account_id}>
                <select id="account_id" name="account_id" className="select">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} · bebas {rp(a.balance - a.allocated)}{held[a.id] ? ` · di target ${rp(held[a.id]!)}` : ''}</option>
                  ))}
                </select>
              </Field>
              <div className="form-grid form-grid-2">
                <Field label="Jumlah" name="amount" error={errors.amount}>
                  <MoneyInput name="amount" error={errors.amount} />
                </Field>
                <Field label="Tanggal" name="occurred_on">
                  <DateTimePicker id="occurred_on" name="occurred_on" mode="date" quick="past" defaultValue={today} required />
                </Field>
              </div>
              <Field label="Catatan" name="note" hint="Opsional">
                <input id="note" name="note" className="input" maxLength={500} />
              </Field>
            </div>
          )}
        </FormModal>
      )}
    </>
  )
}
