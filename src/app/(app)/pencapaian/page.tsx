import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Clock, Flag, Trophy } from 'lucide-react'
import { EmptyState, KpiCard, PageHead, tint } from '@/components/ui/display'
import { isoToDay } from '@/lib/dates'
import { formatDateTime, formatDay, formatDuration, formatNumber } from '@/lib/format'
import { GOAL_COLUMNS, withProgress } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Goal } from '@/lib/types'
import { goalNumbers } from '../target/GoalCard'

export const metadata: Metadata = { title: 'Pencapaian' }

export default async function Page() {
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const [goalsRes, ms, tasks, mods, mins] = await Promise.all([
    supabase.from('goals').select(GOAL_COLUMNS).not('achieved_at', 'is', null).order('achieved_at', { ascending: false }),
    supabase.from('goal_milestones').select('id, goal_id, title, threshold, reached_at').not('reached_at', 'is', null).order('reached_at', { ascending: false }).limit(20),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'selesai'),
    supabase.from('learning_modules').select('id', { count: 'exact', head: true }).not('completed_at', 'is', null),
    supabase.from('learning_sessions').select('duration_minutes'),
  ])
  const achieved = await withProgress(supabase, (goalsRes.data ?? []) as Goal[])
  const totalMinutes = (mins.data ?? []).reduce((n, s) => n + s.duration_minutes, 0)
  const goalTitle = new Map(achieved.map((g) => [g.id, g.title]))
  const { data: msGoals } = await supabase.from('goals').select('id, title').in('id', [...new Set((ms.data ?? []).map((m) => m.goal_id))])
  for (const g of msGoals ?? []) goalTitle.set(g.id, g.title)

  return (
    <div className="page">
      <PageHead title="Pencapaian" description="Riwayat target yang berhasil dicapai, dicatat sekali saat syaratnya terpenuhi." />

      <div className="kpis kpis-4">
        <KpiCard label="Target tercapai" value={achieved.length} icon={<Trophy size={20} strokeWidth={1.9} />} color="var(--c-peach)" caption="Sepanjang waktu" />
        <KpiCard label="Tugas selesai" value={tasks.count ?? 0} icon={<CheckCircle2 size={20} strokeWidth={1.9} />} color="var(--c-blue)" caption="Sepanjang waktu" />
        <KpiCard label="Modul dituntaskan" value={mods.count ?? 0} icon={<Flag size={20} strokeWidth={1.9} />} color="var(--c-lilac)" caption="Dari seluruh bidang belajar" />
        <KpiCard label="Total belajar" value={totalMinutes} display={formatDuration(totalMinutes)} icon={<Clock size={20} strokeWidth={1.9} />} color="var(--c-rose)" caption={`${formatNumber((mins.data ?? []).length)} sesi`} />
      </div>

      <div className="row-2">
        <section className="card" aria-labelledby="ach-title">
          <div className="card-header"><div><h2 id="ach-title" className="text-[length:var(--fs-h3)]">Target tercapai</h2><p className="text-caption">Terbaru di atas</p></div></div>
          {achieved.length === 0 ? <EmptyState icon={<Trophy size={20} strokeWidth={1.75} />} title="Belum ada target tercapai" description="Saat progres target mencapai 100%, target otomatis tercatat di sini." action={<Link href="/target" className="btn btn-secondary">Lihat target</Link>} /> : (
            <ul className="items">
              {achieved.map((g) => {
                const n = goalNumbers(g)
                return (
                  <li key={g.id} className="flex items-center gap-4 px-5 py-4 border-b border-[var(--border)] last:border-0">
                    <span className="tint-icon" style={tint('var(--c-peach)')} aria-hidden="true"><Trophy size={19} /></span>
                    <Link href={`/target/${g.id}`} className="min-w-0 flex-1">
                      <span className="item-title block truncate">{g.title}</span>
                      <span className="item-sub block truncate">{n.target} · dimulai {formatDay(g.start_date)}</span>
                    </Link>
                    <span className="text-right">
                      <span className="item-meta block">{formatDateTime(g.achieved_at, user.timezone)}</span>
                      {g.status === 'arsip' && <span className="badge mt-1">Diarsipkan</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card h-fit" aria-labelledby="ms-title">
          <div className="card-header"><div><h2 id="ms-title" className="text-[length:var(--fs-h3)]">Tahapan terbaru</h2><p className="text-caption">Langkah-langkah yang sudah dilewati</p></div></div>
          <div className="card-body pt-1">
            {(ms.data ?? []).length === 0 ? <p className="text-caption py-3">Belum ada tahapan tercapai.</p> : (
              <ul className="items">
                {(ms.data ?? []).map((m) => (
                  <li key={m.id} className="item">
                    <span className="act-icon" style={tint('var(--c-blue)')} aria-hidden="true"><Flag size={15} /></span>
                    <Link href={`/target/${m.goal_id}`} className="min-w-0 flex-1">
                      <span className="item-title block truncate">{m.title || `Ambang ${formatNumber(m.threshold)}`}</span>
                      <span className="item-sub block truncate">{goalTitle.get(m.goal_id) ?? 'Target'}</span>
                    </Link>
                    <span className="item-meta">{formatDay(isoToDay(m.reached_at!, user.timezone))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
