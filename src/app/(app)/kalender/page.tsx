import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { EmptyState, PageHead, SectionHead } from '@/components/ui/display'
import { addDays, isoToDay, startOfDayIso, todayIn, weekdayMon0 } from '@/lib/dates'
import { formatDayLong, formatTime } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Task } from '@/lib/types'
import { str } from '@/lib/url'
import { NewTaskButton } from '../tugas/TaskForm'
import { loadLinkOptions } from '@/lib/queries'

export const metadata: Metadata = { title: 'Kalender' }

interface Ev { id: string; day: string; title: string; time: string; href: string; color: string; done: boolean; kind: string; sort: string }

const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

export default async function Page({ searchParams }: PageProps<'/kalender'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const today = todayIn(tz)
  const month = /^\d{4}-\d{2}$/.test(str(sp.bulan)) ? str(sp.bulan) : today.slice(0, 7)
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const nextMonth = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`
  const prevMonth = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
  const gridStart = addDays(first, -weekdayMon0(first))
  const gridDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const fromIso = startOfDayIso(gridDays[0]!, tz)
  const toIso = startOfDayIso(addDays(gridDays[41]!, 1), tz)

  const supabase = await createClient()
  const [tasksRes, goalsRes, options] = await Promise.all([
    supabase.from('tasks').select('id, kind, title, status, due_at, start_at, end_at')
      .or(`and(due_at.gte.${fromIso},due_at.lt.${toIso}),and(start_at.gte.${fromIso},start_at.lt.${toIso})`).neq('status', 'dibatalkan').limit(1000),
    supabase.from('goals').select('id, title, due_date').eq('status', 'aktif').gte('due_date', gridDays[0]!).lte('due_date', gridDays[41]!),
    loadLinkOptions(supabase),
  ])

  const events: Ev[] = []
  const nowIso = new Date().toISOString()
  for (const t of (tasksRes.data ?? []) as Task[]) {
    const done = t.status === 'selesai'
    if (t.kind === 'kegiatan' && t.start_at) {
      events.push({ id: t.id, day: isoToDay(t.start_at, tz), title: t.title, time: formatTime(t.start_at, tz), href: `/tugas/${t.id}`, color: 'var(--c-lilac)', done, kind: 'Kegiatan', sort: t.start_at })
    } else {
      const at = t.due_at ?? t.start_at
      if (!at) continue
      const late = !done && t.due_at !== null && t.due_at < nowIso
      events.push({ id: t.id, day: isoToDay(at, tz), title: t.title, time: formatTime(at, tz), href: `/tugas/${t.id}`, color: done ? 'var(--n-400)' : late ? 'var(--err)' : 'var(--c-blue)', done, kind: t.due_at ? 'Tenggat tugas' : 'Tugas', sort: at })
    }
  }
  for (const g of goalsRes.data ?? []) {
    events.push({ id: g.id, day: g.due_date!, title: `Target: ${g.title}`, time: '', href: `/target/${g.id}`, color: 'var(--c-peach)', done: false, kind: 'Tenggat target', sort: `${g.due_date}T23:59` })
  }
  events.sort((a, b) => a.sort.localeCompare(b.sort))
  const byDay = new Map<string, Ev[]>()
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
  const monthEvents = events.filter((e) => e.day.startsWith(month))
  const agendaDays = [...new Set(monthEvents.map((e) => e.day))]
  const title = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`))

  return (
    <div className="page">
      <PageHead title="Kalender" description="Tenggat tugas, jadwal kegiatan, dan tenggat target dalam satu tampilan."
        actions={<NewTaskButton options={options} preset={{ kind: 'kegiatan' }} label="Kegiatan" />} />

      <section className="card" aria-labelledby="cal-title">
        <div className="card-header">
          <h2 id="cal-title" className="capitalize"><CalendarDays size={18} />{title}</h2>
          <div className="control-row">
            <div className="flex items-center gap-3 text-caption max-sm:hidden">
              <span className="flex items-center gap-1.5"><span className="swatch" style={{ background: 'var(--c-blue)' }} />Tugas</span>
              <span className="flex items-center gap-1.5"><span className="swatch" style={{ background: 'var(--c-lilac)' }} />Kegiatan</span>
              <span className="flex items-center gap-1.5"><span className="swatch" style={{ background: 'var(--c-peach)' }} />Target</span>
              <span className="flex items-center gap-1.5"><span className="swatch" style={{ background: 'var(--err)' }} />Terlambat</span>
            </div>
            <Link href={`/kalender?bulan=${prevMonth}`} className="btn btn-secondary btn-sm btn-icon" aria-label="Bulan sebelumnya"><ChevronLeft size={16} /></Link>
            <Link href="/kalender" className="btn btn-secondary btn-sm">Hari ini</Link>
            <Link href={`/kalender?bulan=${nextMonth}`} className="btn btn-secondary btn-sm btn-icon" aria-label="Bulan berikutnya"><ChevronRight size={16} /></Link>
          </div>
        </div>
        <div className="cal" role="grid" aria-label={`Kalender ${title}`}>
          {DOW.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
          {gridDays.map((d) => {
            const list = byDay.get(d) ?? []
            return (
              <div key={d} role="gridcell" className={`cal-day${d.startsWith(month) ? '' : ' out'}${d === today ? ' today' : ''}`} aria-label={`${formatDayLong(d)}, ${list.length} agenda`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <div className="cal-evs flex flex-col gap-0.5">
                  {list.slice(0, 3).map((e) => (
                    <Link key={`${e.id}-${e.day}`} href={e.href} className="cal-ev" style={{ '--ev': e.color, textDecoration: e.done ? 'line-through' : undefined } as React.CSSProperties} title={`${e.kind}: ${e.title}`}>
                      {e.time && <span className="opacity-75">{e.time} </span>}{e.title}
                    </Link>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} lagi</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="agenda-title">
        <SectionHead id="agenda-title" icon={<ListChecks size={18} />} title="Agenda bulan ini" desc="Diurutkan menurut tanggal">
          {monthEvents.length > 0 && <span className="badge">{monthEvents.length} agenda</span>}
        </SectionHead>
        {agendaDays.length === 0 ? <EmptyState icon={<CalendarDays size={20} strokeWidth={1.75} />} title="Tidak ada agenda bulan ini" description="Tambahkan tenggat ke tugas atau buat kegiatan." /> : (
          <div className="card-body pt-2 flex flex-col gap-4">
            {agendaDays.map((d) => (
              <div key={d}>
                <p className={`text-overline mb-1${d === today ? ' !text-[var(--brand)]' : ''}`}>{formatDayLong(d)}{d === today ? ' · hari ini' : ''}</p>
                <ul className="items">
                  {byDay.get(d)!.map((e) => (
                    <li key={`${e.id}-a`} className={`item${e.done ? ' is-done' : ''}`}>
                      <span className="swatch shrink-0" style={{ background: e.color }} aria-hidden="true" />
                      <Link href={e.href} className="item-title flex-1 min-w-0 truncate hover:text-[var(--brand)]">{e.title}</Link>
                      <span className="item-meta">{e.kind}{e.time ? ` · ${e.time}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
