import type { Metadata } from 'next'
import Link from 'next/link'
import { Award, CheckCircle2, Clock, Flag, NotebookPen, Repeat, Trophy } from 'lucide-react'
import { EmptyState, KpiCard, PageHead, ProgressBar, SectionHead, tint, solid } from '@/components/ui/display'
import { addDays, dayRange, isoToDay, startOfDayIso, todayIn } from '@/lib/dates'
import { formatDateTime, formatDay, formatDuration, formatNumber } from '@/lib/format'
import { GOAL_COLUMNS, loadProgress, mergeProgress } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Achievement, Goal } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { BADGE_COLOR, badgeIcon } from '@/lib/badges'
import { ScrollRows } from '@/components/ui/ScrollRows'
import { goalNumbers } from '../target/GoalCard'

export const metadata: Metadata = { title: 'Pencapaian' }

const PERIODS = [{ key: '7', days: 7 }, { key: '30', days: 30 }, { key: '90', days: 90 }] as const

export default async function Page({ searchParams }: PageProps<'/pencapaian'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const today = todayIn(tz)
  const period = PERIODS.find((p) => p.key === str(sp.periode)) ?? PERIODS[0]
  const curFrom = addDays(today, -(period.days - 1))
  const prevFrom = addDays(curFrom, -period.days)
  const supabase = await createClient()

  // Beri lencana yang syaratnya baru terpenuhi (idempoten) sebelum membaca daftar lencana.
  await supabase.rpc('evaluate_achievements')

  const [goalsRes, ms, progress, titles, defs, earned, metricsRes, doneRes, sessRes, noteRes, checkRes] = await Promise.all([
    supabase.from('goals').select(GOAL_COLUMNS).not('achieved_at', 'is', null).order('achieved_at', { ascending: false }),
    supabase.from('goal_milestones').select('id, goal_id, title, threshold, reached_at').not('reached_at', 'is', null).order('reached_at', { ascending: false }).limit(20),
    loadProgress(supabase),
    supabase.from('goals').select('id, title'),
    supabase.from('achievements').select('id, code, name, description, icon, metric, min_value, sort_order').order('sort_order'),
    supabase.from('user_achievements').select('achievement_id, earned_at'),
    supabase.rpc('my_achievement_metrics'),
    supabase.from('tasks').select('completed_at').gte('completed_at', startOfDayIso(prevFrom, tz)).limit(10000),
    supabase.from('learning_sessions').select('session_date, duration_minutes').gte('session_date', prevFrom).limit(10000),
    supabase.from('journal_entries').select('entry_date').gte('entry_date', prevFrom).limit(10000),
    supabase.from('habit_checkins').select('checkin_date').gte('checkin_date', prevFrom).limit(20000),
  ])
  const achieved = mergeProgress((goalsRes.data ?? []) as Goal[], progress)
  const goalTitle = new Map((titles.data ?? []).map((g) => [g.id, g.title]))
  const badges = (defs.data ?? []) as Achievement[]
  const earnedAt = new Map((earned.data ?? []).map((e) => [e.achievement_id as string, e.earned_at as string]))
  const metrics = new Map(((metricsRes.data ?? []) as Array<{ metric: string; value: number }>).map((m) => [m.metric, Number(m.value)]))
  const earnedCount = badges.filter((b) => earnedAt.has(b.id)).length
  // Yang sudah diraih dulu (terbaru di atas), lalu yang belum diraih menurut progres terdekat.
  const progressOf = (b: Achievement) => Math.min(1, (metrics.get(b.metric) ?? 0) / b.min_value)
  const sortedBadges = [...badges].sort((a, b) => {
    const ea = earnedAt.get(a.id), eb = earnedAt.get(b.id)
    if (ea && eb) return eb.localeCompare(ea)
    if (ea || eb) return ea ? -1 : 1
    return progressOf(b) - progressOf(a)
  })

  // Statistik periode berjalan vs periode sebelumnya (PC-05)
  const curDays = dayRange(curFrom, today)
  const split = <T,>(rows: T[], day: (r: T) => string, weight: (r: T) => number = () => 1) => {
    let cur = 0, prev = 0
    const byDay = new Map(curDays.map((d) => [d, 0]))
    for (const r of rows) {
      const d = day(r)
      if (d >= curFrom) { cur += weight(r); if (byDay.has(d)) byDay.set(d, byDay.get(d)! + weight(r)) } else if (d >= prevFrom) prev += weight(r)
    }
    return { cur, prev, series: curDays.map((d) => byDay.get(d) ?? 0) }
  }
  const sDone = split(doneRes.data ?? [], (r) => isoToDay(r.completed_at!, tz))
  const sMin = split(sessRes.data ?? [], (r) => r.session_date, (r) => r.duration_minutes)
  const sNote = split(noteRes.data ?? [], (r) => r.entry_date)
  const sCheck = split(checkRes.data ?? [], (r) => r.checkin_date)
  const cmp: [string, string] = [`${period.days} hari sebelumnya`, `periode lalu`]

  return (
    <div className="page">
      {/* Sama seperti Beranda: kartu angka langsung di halaman (tanpa dibungkus kartu lagi); periode di kepala halaman. */}
      <PageHead title="Pencapaian"
        description={`Statistik ${formatDay(curFrom)} – ${formatDay(today)} dibanding ${period.days} hari sebelumnya, lencana, dan riwayat target.`}
        actions={
          <div className="seg" role="group" aria-label="Periode statistik">
            {PERIODS.map((p) => <Link key={p.key} href={hrefWith('/pencapaian', sp, { periode: p.key === '7' ? null : p.key })} className={period.key === p.key ? 'on' : ''} scroll={false}>{p.days} hari</Link>)}
          </div>
        } />

          <div className="kpis kpis-4 kpis-summary" aria-label="Statistik perkembangan">
            <KpiCard label="Tugas selesai" value={sDone.cur} icon={<CheckCircle2 size={20} strokeWidth={1.9} />} color="var(--c-blue)" series={sDone.series} thisWeek={sDone.cur} lastWeek={sDone.prev} compare={cmp} />
            <KpiCard label="Waktu belajar" value={sMin.cur} display={formatDuration(sMin.cur)} duration icon={<Clock size={20} strokeWidth={1.9} />} color="var(--c-peach)" series={sMin.series} thisWeek={sMin.cur} lastWeek={sMin.prev} compare={cmp} />
            <KpiCard label="Catatan ditulis" value={sNote.cur} icon={<NotebookPen size={20} strokeWidth={1.9} />} color="var(--c-rose)" series={sNote.series} thisWeek={sNote.cur} lastWeek={sNote.prev} compare={cmp} />
            <KpiCard label="Check-in kebiasaan" value={sCheck.cur} icon={<Repeat size={20} strokeWidth={1.9} />} color="var(--c-lilac)" series={sCheck.series} thisWeek={sCheck.cur} lastWeek={sCheck.prev} compare={cmp} />
          </div>

      <section className="card" aria-labelledby="badge-title">
        <SectionHead quiet id="badge-title" icon={<Award size={18} />} title="Lencana" desc="Diberikan otomatis saat syaratnya terpenuhi, masing-masing sekali">
          <span className="badge">{earnedCount} dari {badges.length} diraih</span>
        </SectionHead>
        <div className="card-body">
          <ScrollRows rows={3} className="badges">
            {sortedBadges.map((b) => {
              const at = earnedAt.get(b.id)
              const val = Math.min(metrics.get(b.metric) ?? 0, b.min_value)
              const c = BADGE_COLOR[b.icon] ?? 'var(--brand)'
              return (
                <div key={b.id} className={`badge-card${at ? ' earned' : ' locked'}`} style={{ '--badge-c': c } as React.CSSProperties}>
                  <span className="badge-medal" style={at ? solid(c) : undefined} aria-hidden="true">{badgeIcon(b.code, b.icon)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="badge-name">{b.name}</span>
                    <span className="item-sub block">{b.description}</span>
                    {at ? (
                      <span className="badge-earned"><Award size={12} aria-hidden="true" />Diraih {formatDay(isoToDay(at, tz))}</span>
                    ) : (
                      <span className="block mt-1">
                        <ProgressBar percent={(val / b.min_value) * 100} label={`Progres lencana ${b.name}`} color={c} />
                        <span className="item-sub">{formatNumber(val)} / {formatNumber(b.min_value)}</span>
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </ScrollRows>
        </div>
      </section>

      <div className="row-2 cols-even">
        <section className="card" aria-labelledby="ach-title">
          <SectionHead id="ach-title" icon={<Trophy size={18} />} title="Target tercapai" desc="Terbaru di atas">
            {achieved.length > 0 && <span className="badge">{achieved.length} target</span>}
          </SectionHead>
          {achieved.length === 0 ? <EmptyState icon={<Trophy size={20} strokeWidth={1.75} />} title="Belum ada target tercapai" description="Saat progres target mencapai 100%, target otomatis tercatat di sini." action={<Link href="/target" className="btn btn-secondary">Lihat target</Link>} /> : (
            <ul className="items items-scroll">
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
                      <span className="item-meta block">{formatDateTime(g.achieved_at, tz)}</span>
                      {g.status === 'arsip' && <span className="badge mt-1">Diarsipkan</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {achieved.length > 0 && (() => {
            // Rata-rata lama mencapai target: dari tanggal mulai sampai tercapai.
            const spans = achieved.filter((g) => g.achieved_at && g.start_date).map((g) => (new Date(g.achieved_at!).getTime() - new Date(`${g.start_date}T00:00:00Z`).getTime()) / 86_400_000)
            const avgDays = spans.length ? Math.max(1, Math.round(spans.reduce((x, y) => x + y, 0) / spans.length)) : null
            return (
              <div className="card-foot">
                <span><strong>{achieved.length}</strong> target tercapai</span>
                {avgDays && <span>Rata-rata <strong>{avgDays} hari</strong> per target</span>}
              </div>
            )
          })()}
        </section>

        <section className="card" aria-labelledby="ms-title">
          <SectionHead id="ms-title" icon={<Flag size={18} />} title="Tahapan terbaru" desc="Langkah-langkah yang sudah dilewati" />
          <div className="card-body pt-1 flex flex-col">
            {(ms.data ?? []).length === 0 ? <EmptyState icon={<Flag size={20} strokeWidth={1.75} />} title="Belum ada tahapan tercapai" description="Tahapan target yang terlewati muncul di sini." className="fill" /> : (
              <ul className="items items-scroll">
                {(ms.data ?? []).map((m) => (
                  <li key={m.id} className="item">
                    <span className="act-icon" style={tint('var(--c-blue)')} aria-hidden="true"><Flag size={15} /></span>
                    <Link href={`/target/${m.goal_id}`} className="min-w-0 flex-1">
                      <span className="item-title block truncate">{m.title || `Ambang ${formatNumber(m.threshold)}`}</span>
                      <span className="item-sub block truncate">{goalTitle.get(m.goal_id) ?? 'Target'}</span>
                    </Link>
                    <span className="item-meta">{formatDay(isoToDay(m.reached_at!, tz))}</span>
                  </li>
                ))}
              </ul>
            )}
            {(ms.data ?? []).length > 0 && (
              <div className="panel-foot">
                <span><strong>{(ms.data ?? []).length}{(ms.data ?? []).length >= 20 ? '+' : ''}</strong> tahapan tercapai</span>
                <Link href="/target" className="link-sm">Lihat target</Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
