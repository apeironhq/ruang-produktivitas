import type { Metadata } from 'next'
import Link from 'next/link'
import { Archive, ArchiveRestore, CalendarCheck, Flame, Repeat, Trash2 } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { EmptyState, KpiCard, PageHead, ProgressBar, SectionHead } from '@/components/ui/display'
import { addDays, todayIn, weekdayMon0 } from '@/lib/dates'
import { formatDay } from '@/lib/format'
import { DOW_SHORT, habitStats } from '@/lib/habits'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Habit } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { deleteHabit, setHabitArchived } from './actions'
import { CheckTodayButton, DayDot, EditHabitButton, NewHabitButton } from './HabitForms'

export const metadata: Metadata = { title: 'Kebiasaan' }

export default async function Page({ searchParams }: PageProps<'/kebiasaan'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const showArchived = str(sp.arsip) === '1'
  const supabase = await createClient()
  const [habitRes, checkRes] = await Promise.all([
    supabase.from('habits').select('id, name, description, frequency, times_per_week, is_archived, created_at').order('created_at'),
    supabase.from('habit_checkins').select('habit_id, checkin_date').gte('checkin_date', addDays(today, -400)).limit(20000),
  ])
  const all = (habitRes.data ?? []) as Habit[]
  const byHabit = new Map<string, string[]>()
  for (const c of checkRes.data ?? []) byHabit.set(c.habit_id, [...(byHabit.get(c.habit_id) ?? []), c.checkin_date])
  const active = all.filter((h) => !h.is_archived)
  const shown = showArchived ? all.filter((h) => h.is_archived) : active
  const stats = new Map(all.map((h) => [h.id, habitStats(byHabit.get(h.id) ?? [], today)]))
  const daily = active.filter((h) => h.frequency === 'harian')
  const doneTodayDaily = daily.filter((h) => stats.get(h.id)!.doneToday).length
  const bestStreak = Math.max(0, ...active.map((h) => stats.get(h.id)!.best))
  const currentBest = Math.max(0, ...active.map((h) => stats.get(h.id)!.current))
  // Jumlah check-in per hari, 7 hari terakhir (semua kebiasaan aktif) untuk grafik kecil
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const checksPerDay = last7.map((d) => active.filter((h) => (byHabit.get(h.id) ?? []).includes(d)).length)
  const dayLabel = (d: string) => `${DOW_SHORT[weekdayMon0(d)]} ${formatDay(d, { day: 'numeric', month: 'short' })}`

  return (
    <div className="page">
      <PageHead title="Kebiasaan" description="Bangun kebiasaan dengan check-in harian; streak dan lencana dihitung otomatis." actions={<NewHabitButton />} />

      <div className="kpis kpis-3">
        <KpiCard label="Check-in hari ini" value={null} display={`${doneTodayDaily}/${daily.length}`} icon={<CalendarCheck size={20} strokeWidth={1.9} />} color="var(--c-blue)"
          caption={daily.length ? (doneTodayDaily === daily.length ? 'Semua kebiasaan harian tuntas' : `${daily.length - doneTodayDaily} kebiasaan harian tersisa`) : 'Belum ada kebiasaan harian'}
          progress={daily.length ? (doneTodayDaily / daily.length) * 100 : undefined} />
        <KpiCard label="Streak berjalan" value={null} display={`${currentBest} hari`} icon={<Flame size={20} strokeWidth={1.9} />} color="var(--c-peach)" caption="Check-in 7 hari terakhir" series={checksPerDay} />
        <KpiCard label="Streak terbaik" value={null} display={`${bestStreak} hari`} icon={<Repeat size={20} strokeWidth={1.9} />} color="var(--c-lilac)" href="/pencapaian"
          caption={bestStreak ? (currentBest >= bestStreak ? 'Streak berjalan menyamai rekor' : `${bestStreak - currentBest} hari lagi menyamai rekor`) : 'Rekor sepanjang waktu'}
          progress={bestStreak ? (currentBest / bestStreak) * 100 : 0} />
      </div>

      <nav className="tabs" aria-label="Saring kebiasaan">
        <Link href={hrefWith('/kebiasaan', sp, { arsip: null })} className={`tab${!showArchived ? ' active' : ''}`}>Aktif<span className="tab-count">{active.length}</span></Link>
        <Link href={hrefWith('/kebiasaan', sp, { arsip: '1' })} className={`tab${showArchived ? ' active' : ''}`}>Diarsipkan<span className="tab-count">{all.length - active.length}</span></Link>
      </nav>

      <section className="card" aria-labelledby="habit-title">
        <SectionHead id="habit-title" icon={<Repeat size={18} />} title={showArchived ? 'Kebiasaan diarsipkan' : 'Kebiasaan aktif'}
          desc={showArchived ? 'Riwayat check-in tetap tersimpan' : <>Hari ini {formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })} · ketuk kotak hari untuk mengisi hari yang terlewat</>}>
          {shown.length > 0 && <span className="badge">{shown.length} kebiasaan</span>}
        </SectionHead>
        {shown.length === 0 ? (
          <EmptyState icon={<Repeat size={20} strokeWidth={1.75} />} title={showArchived ? 'Tidak ada kebiasaan diarsipkan' : 'Belum ada kebiasaan'}
            description={showArchived ? undefined : 'Mulai dari satu kebiasaan kecil, mis. "Baca 10 halaman" atau "Olahraga 3× per minggu".'}
            action={showArchived ? undefined : <NewHabitButton />} />
        ) : (
          <ul className="items">
            {shown.map((h) => {
              const s = stats.get(h.id)!
              const weekly = h.frequency === 'mingguan'
              return (
                <li key={h.id} className="habit-row">
                  <CheckTodayButton habitId={h.id} name={h.name} today={today} done={s.doneToday} />
                  <div className="min-w-0 flex-1">
                    <span className="item-title block truncate">{h.name}</span>
                    <span className="meta-row mt-0.5">
                      <span>{weekly ? `Mingguan · ${h.times_per_week}× per minggu` : 'Harian'}</span>
                      {s.current > 0 && <span className="streak"><Flame size={13} aria-hidden="true" />{s.current} hari</span>}
                      <span>Terbaik {s.best} hari</span>
                      <span>{s.total} check-in</span>
                    </span>
                    {weekly && (
                      <div className="mt-2 max-w-[260px]">
                        <ProgressBar percent={(s.thisWeek / h.times_per_week) * 100} label={`Minggu ini ${h.name}`} />
                        <span className="item-sub">{s.thisWeek} dari {h.times_per_week}× minggu ini</span>
                      </div>
                    )}
                  </div>
                  <div className="day-strip" aria-label="7 hari terakhir">
                    {s.last7.map((d) => <DayDot key={d.day} habitId={h.id} day={d.day} label={dayLabel(d.day)} done={d.done} isToday={d.day === today} />)}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <EditHabitButton initial={{ id: h.id, name: h.name, description: h.description, frequency: h.frequency, times_per_week: h.times_per_week }} />
                    <ActionButton action={setHabitArchived.bind(null, h.id, !h.is_archived)} className={`btn btn-ghost btn-sm btn-icon${h.is_archived ? '' : ' is-warn'}`} ariaLabel={h.is_archived ? 'Aktifkan' : 'Arsipkan'} title={h.is_archived ? 'Aktifkan' : 'Arsipkan'}>
                      {h.is_archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </ActionButton>
                    <ConfirmButton action={deleteHabit.bind(null, h.id)} title="Hapus kebiasaan?" message={`"${h.name}" beserta ${s.total} check-in-nya dihapus permanen. Pilih Arsipkan bila hanya ingin berhenti sementara.`}
                      className="btn btn-ghost btn-sm btn-icon is-danger" ariaLabel={`Hapus ${h.name}`}><Trash2 size={15} /></ConfirmButton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
