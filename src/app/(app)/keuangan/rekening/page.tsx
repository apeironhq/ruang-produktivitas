import type { Metadata } from 'next'
import Link from 'next/link'
import { Archive, ArchiveRestore, ArrowLeftRight, Banknote, Landmark, Smartphone, Trash2, Wallet } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { EmptyState, PageHead, SectionHead, tint } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { loadAccounts, loadCategories } from '@/lib/finance'
import { formatRupiah } from '@/lib/format'
import { ACCOUNT_KIND } from '@/lib/labels'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { hrefWith, str } from '@/lib/url'
import { deleteAccount, setAccountArchived } from '../actions'
import { AccountButton, TransactionButton } from '../FinanceForms'
import { FinanceTabs } from '../FinanceNav'

export const metadata: Metadata = { title: 'Rekening' }

const KIND_ICON: Record<string, React.ReactNode> = {
  tunai: <Banknote size={19} />, bank: <Landmark size={19} />, dompet_digital: <Smartphone size={19} />, lainnya: <Wallet size={19} />,
}

export default async function Page({ searchParams }: PageProps<'/keuangan/rekening'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const showArchived = str(sp.arsip) === '1'
  const supabase = await createClient()
  const [all, categories] = await Promise.all([loadAccounts(supabase, true), loadCategories(supabase)])
  const active = all.filter((a) => !a.is_archived)
  const shown = showArchived ? all.filter((a) => a.is_archived) : active
  const total = active.reduce((n, a) => n + a.balance, 0)
  const allocated = active.reduce((n, a) => n + a.allocated, 0)

  return (
    <div className="page">
      <PageHead title="Keuangan" description="Rekening, pemasukan, pengeluaran, transfer, dan anggaran — saldo dihitung dari transaksi."
        actions={<>
          {active.length >= 2 && <TransactionButton accounts={active} categories={categories} today={today} kind="transfer" label="Transfer" className="btn btn-secondary" />}
          <AccountButton />
        </>} />
      <FinanceTabs />

      <section className="card" aria-labelledby="acc-title">
        <SectionHead id="acc-title" icon={<Landmark size={18} />} title={showArchived ? 'Rekening diarsipkan' : 'Rekening & dompet'}
          desc={showArchived ? 'Tidak tampil di pilihan transaksi; riwayatnya tetap utuh' : `Total saldo ${formatRupiah(total)}${allocated ? ` · ${formatRupiah(allocated)} dialokasikan ke target` : ''}`}>
          <div className="seg" role="group" aria-label="Saring rekening">
            <Link href={hrefWith('/keuangan/rekening', sp, { arsip: null })} className={!showArchived ? 'on' : ''} aria-current={!showArchived ? 'page' : undefined}>Aktif<span className="tab-count">{active.length}</span></Link>
            <Link href={hrefWith('/keuangan/rekening', sp, { arsip: '1' })} className={showArchived ? 'on' : ''} aria-current={showArchived ? 'page' : undefined}>Diarsipkan<span className="tab-count">{all.length - active.length}</span></Link>
          </div>
        </SectionHead>
        {shown.length === 0 ? (
          <EmptyState icon={<Landmark size={20} strokeWidth={1.75} />} title={showArchived ? 'Tidak ada rekening diarsipkan' : 'Belum ada rekening'}
            description={showArchived ? undefined : 'Tambahkan tunai, rekening bank, atau dompet digital beserta saldo awalnya.'}
            action={showArchived ? undefined : <AccountButton />} />
        ) : (
          <div className="card-body">
            <div className="grid-cards">
              {shown.map((a) => (
                <article key={a.id} className="card kpi">
                  <div className="kpi-top">
                    <span className="kpi-icon" style={tint('var(--c-blue)')} aria-hidden="true">{KIND_ICON[a.kind]}</span>
                    <span className="min-w-0">
                      <span className="kpi-label block truncate">{a.name}</span>
                      <span className="item-sub">{ACCOUNT_KIND[a.kind]}</span>
                    </span>
                  </div>
                  <div>
                    <span className="kpi-value text-[1.5rem]" style={{ color: a.balance < 0 ? 'var(--err)' : undefined }}>{formatRupiah(a.balance)}</span>
                    <p className="kpi-delta muted">
                      {a.allocated ? <>Untuk target {formatRupiah(a.allocated)} · bebas {formatRupiah(a.balance - a.allocated)}</> : <>Saldo awal {formatRupiah(a.opening_balance)}</>}
                    </p>
                  </div>
                  <div className="acct-actions flex items-center gap-2 flex-wrap">
                    <Link href={`/keuangan/transaksi?rekening=${a.id}`} className="btn btn-secondary btn-sm"><ArrowLeftRight size={15} />Mutasi</Link>
                    <AccountButton initial={{ id: a.id, name: a.name, kind: a.kind, opening_balance: a.opening_balance }} />
                    <ActionButton action={setAccountArchived.bind(null, a.id, !a.is_archived)} className={`btn btn-secondary btn-sm${a.is_archived ? '' : ' is-warn'}`}>
                      {a.is_archived ? <><ArchiveRestore size={15} /><span className="btn-text">Aktifkan</span></> : <><Archive size={15} /><span className="btn-text">Arsipkan</span></>}
                    </ActionButton>
                    <ConfirmButton action={deleteAccount.bind(null, a.id)} title="Hapus rekening?" message={`"${a.name}" dihapus. Rekening yang masih punya transaksi tidak bisa dihapus — arsipkan saja.`}
                      className="btn btn-secondary btn-sm btn-icon is-danger ml-auto" ariaLabel={`Hapus ${a.name}`}><Trash2 size={15} /></ConfirmButton>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
