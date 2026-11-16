import type { Metadata } from 'next'
import Link from 'next/link'
import { Gauge, Target, Trophy } from 'lucide-react'
import { EmptyState, KpiCard, PageHead, SectionHead } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { GOAL_COLUMNS, loadProgress, mergeProgress } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Goal } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { GoalCard } from './GoalCard'
import { NewGoalButton } from './GoalForm'

export const metadata: Metadata = { title: 'Target Saya' }

const TABS = [
  { key: '', status: 'aktif', label: 'Aktif' },
  { key: 'tercapai', status: 'tercapai', label: 'Tercapai' },
  { key: 'arsip', status: 'arsip', label: 'Diarsipkan' },
] as const

export default async function Page({ searchParams }: PageProps<'/target'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const tab = TABS.find((t) => t.key === str(sp.tab)) ?? TABS[0]
  const [{ data: all }, progress] = await Promise.all([
    supabase.from('goals').select(GOAL_COLUMNS).order('priority', { ascending: false }).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
    loadProgress(supabase),
  ])
  const goals = mergeProgress((all ?? []) as Goal[], progress)
  const counts = { aktif: 0, tercapai: 0, arsip: 0 }
  for (const g of goals) counts[g.status]++
  const shown = goals.filter((g) => g.status === tab.status)
  const activeWithProgress = goals.filter((g) => g.status === 'aktif')
  const avg = activeWithProgress.length ? activeWithProgress.reduce((n, g) => n + g.percent, 0) / activeWithProgress.length : 0
  const today = todayIn(user.timezone)

  return (
    <div className="page">
      <PageHead title="Target Saya" description="Tetapkan target, pecah menjadi tahapan, dan pantau perkembangannya." actions={<NewGoalButton today={today} />} />

      <div className="kpis kpis-3">
        <KpiCard label="Target aktif" value={counts.aktif} icon={<Target size={20} strokeWidth={1.9} />} color="var(--c-blue)" caption="Sedang diperjuangkan" />
        <KpiCard label="Rata-rata progres" value={null} display={`${formatNumber(Math.round(avg))}%`} icon={<Gauge size={20} strokeWidth={1.9} />} color="var(--c-lilac)" caption="Dari seluruh target aktif" progress={counts.aktif ? avg : undefined} />
        <KpiCard label="Target tercapai" value={counts.tercapai} icon={<Trophy size={20} strokeWidth={1.9} />} color="var(--c-peach)" href="/pencapaian" caption="Lihat riwayat pencapaian" />
      </div>

      <nav className="tabs" aria-label="Saring target">
        {TABS.map((t) => (
          <Link key={t.key} href={hrefWith('/target', sp, { tab: t.key || null })} className={`tab${tab.key === t.key ? ' active' : ''}`} aria-current={tab.key === t.key ? 'page' : undefined}>
            {t.label}<span className="tab-count">{counts[t.status]}</span>
          </Link>
        ))}
      </nav>

      <section className="card" aria-labelledby="goal-title">
        <SectionHead id="goal-title" icon={<Target size={18} />} title={`Target ${tab.label.toLowerCase()}`}
          desc={tab.status === 'aktif' ? 'Progres dihitung dari satu sumber data' : tab.status === 'tercapai' ? 'Tercatat sekali saat syaratnya terpenuhi' : 'Target yang disimpan tanpa dipantau'}>
          {shown.length > 0 && <span className="badge">{shown.length} target</span>}
        </SectionHead>
        {shown.length === 0 ? (
          <EmptyState icon={<Target size={20} strokeWidth={1.75} />}
            title={tab.status === 'aktif' ? 'Belum ada target aktif' : tab.status === 'tercapai' ? 'Belum ada target tercapai' : 'Tidak ada target diarsipkan'}
            description={tab.status === 'aktif' ? 'Contoh: Tabungan Rp100.000.000, Menyelesaikan 10 modul Next.js, atau Membaca 12 buku.' : undefined}
            action={tab.status === 'aktif' ? <NewGoalButton today={today} /> : undefined} />
        ) : (
          <div className="card-body"><div className="grid-cards">{shown.map((g) => <GoalCard key={g.id} g={g} />)}</div></div>
        )}
      </section>
    </div>
  )
}
