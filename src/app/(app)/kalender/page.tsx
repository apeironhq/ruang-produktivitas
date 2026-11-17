import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { EmptyState, PageHead } from '@/components/ui/display'
import { addDays, isoToDay, startOfDayIso, todayIn, weekdayMon0 } from '@/lib/dates'
import { formatDay, formatDayLong, formatTime } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Task } from '@/lib/types'
import { str } from '@/lib/url'
import { NewTaskButton } from '../tugas/TaskForm'
import { loadLinkOptions } from '@/lib/queries'
import { DayFocus } from './DayFocus'
import { MonthPicker } from './MonthPicker'

export const metadata: Metadata = { title: 'Kalender' }

interface Ev { id: string; day: string; title: string; time: string; href: string; color: string; done: boolean; kind: string; sort: string }

const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const LEGEND = [
  { label: 'Tugas', color: 'var(--c-blue)' }, { label: 'Kegiatan', color: 'var(--c-lilac)' },
  { label: 'Target', color: 'var(--c-peach)' }, { label: 'Terlambat', color: 'var(--err)' }, { label: 'Selesai', color: 'var(--n-300)' },
]
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y! * 12 + (m! - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export default async function Page({ searchParams }: PageProps<'/kalender'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const today = todayIn(tz)
  const week = str(sp.tampilan) === 'minggu'
  const bulanParam = /^\d{4}-\d{2}$/.test(str(sp.bulan)) ? str(sp.bulan) : ''
  const tglParam = isDay(str(sp.tgl)) ? str(sp.tgl) : ''

  // Hari terpilih (panel kanan) dan bulan yang tampil.
  let sel = tglParam || (bulanParam ? (bulanParam === today.slice(0, 7) ? today : `${bulanParam}-01`) : today)
  const month = week ? sel.slice(0, 7) : bulanParam || sel.slice(0, 7)
  const first = `${month}-01`

  // Hari-hari di kisi: 6 minggu untuk tampilan Bulan, 7 hari (Sen–Min) untuk tampilan Minggu.
  const gridStart = week ? addDays(sel, -weekdayMon0(sel)) : addDays(first, -weekdayMon0(first))
  const gridDays = Array.from({ length: week ? 7 : 42 }, (_, i) => addDays(gridStart, i))
  if (!gridDays.includes(sel)) sel = month === today.slice(0, 7) ? today : first
  const last = gridDays[gridDays.length - 1]!
  const fromIso = startOfDayIso(gridDays[0]!, tz)
  const toIso = startOfDayIso(addDays(last, 1), tz)

  const supabase = await createClient()
  const [tasksRes, goalsRes, options] = await Promise.all([
    supabase.from('tasks').select('id, kind, title, status, due_at, start_at, end_at')
      .or(`and(due_at.gte.${fromIso},due_at.lt.${toIso}),and(start_at.gte.${fromIso},start_at.lt.${toIso})`).neq('status', 'dibatalkan').limit(1000),
    supabase.from('goals').select('id, title, due_date').eq('status', 'aktif').gte('due_date', gridDays[0]!).lte('due_date', last),
    loadLinkOptions(supabase),
  ])

  const events: Ev[] = []
  const nowIso = new Date().toISOString()
  for (const t of (tasksRes.data ?? []) as Task[]) {
    const done = t.status === 'selesai'
    if (t.kind === 'kegiatan' && t.start_at) {
      events.push({ id: t.id, day: isoToDay(t.start_at, tz), title: t.title, time: formatTime(t.start_at, tz), href: `/tugas/${t.id}`, color: done ? 'var(--n-300)' : 'var(--c-lilac)', done, kind: 'Kegiatan', sort: t.start_at })
    } else {
      const at = t.due_at ?? t.start_at
      if (!at) continue
      const late = !done && t.due_at !== null && t.due_at < nowIso
      events.push({ id: t.id, day: isoToDay(at, tz), title: t.title, time: formatTime(at, tz), href: `/tugas/${t.id}`, color: done ? 'var(--n-300)' : late ? 'var(--err)' : 'var(--c-blue)', done, kind: late ? 'Tugas terlambat' : t.due_at ? 'Tenggat tugas' : 'Tugas', sort: at })
    }
  }
  for (const g of goalsRes.data ?? []) {
    events.push({ id: g.id, day: g.due_date!, title: `Target: ${g.title}`, time: '', href: `/target/${g.id}`, color: 'var(--c-peach)', done: false, kind: 'Tenggat target', sort: `${g.due_date}T23:59` })
  }
  events.sort((a, b) => a.sort.localeCompare(b.sort))
  const byDay = new Map<string, Ev[]>()
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
  const selEvents = byDay.get(sel) ?? []

  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`))
  const title = week
    ? `${formatDay(gridDays[0]!, { day: 'numeric', month: gridDays[0]!.slice(0, 7) === last.slice(0, 7) ? undefined : 'short' })} – ${formatDay(last, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : monthLabel

  // Tautan navigasi (scroll={false} agar halaman tidak lompat ke atas).
  const prevHref = week ? `/kalender?tampilan=minggu&tgl=${addDays(sel, -7)}` : `/kalender?bulan=${shiftMonth(month, -1)}`
  const nextHref = week ? `/kalender?tampilan=minggu&tgl=${addDays(sel, 7)}` : `/kalender?bulan=${shiftMonth(month, 1)}`
  const dayHref = (d: string) => week ? `/kalender?tampilan=minggu&tgl=${d}` : `/kalender?bulan=${month}&tgl=${d}`

  const chip = (e: Ev, full = false) => (
    <Link key={`${e.id}-${e.day}`} href={e.href} className={`cal-ev${e.done ? ' done' : ''}${full ? ' full' : ''}`} style={{ '--ev': e.color } as React.CSSProperties} title={`${e.kind}: ${e.title}`}>
      {e.time && <span className="cal-ev-time">{e.time}</span>}<span className="cal-ev-title">{e.title}</span>
    </Link>
  )

  return (
    <div className="page">
      <PageHead title="Kalender" description="Tenggat tugas, jadwal kegiatan, dan tenggat target dalam satu tampilan."
        actions={<NewTaskButton options={options} preset={{ kind: 'kegiatan' }} label="Kegiatan" />} />

      <div className="cal-layout">
        <section className="card min-w-0" aria-labelledby="cal-title">
          <div className="card-header">
            <h2 id="cal-title" className="sr-only">Kalender {title}</h2>
            <MonthPicker label={title} month={month} today={today} week={week} />
            <div className="control-row">
              <div className="seg" role="group" aria-label="Tampilan kalender">
                <Link href={`/kalender?bulan=${month}&tgl=${sel}`} scroll={false} className={week ? '' : 'on'} aria-current={week ? undefined : 'page'}><CalendarDays size={15} />Bulan</Link>
                <Link href={`/kalender?tampilan=minggu&tgl=${sel}`} scroll={false} className={week ? 'on' : ''} aria-current={week ? 'page' : undefined}><CalendarRange size={15} />Minggu</Link>
              </div>
              <div className="flex items-center gap-1.5">
                <Link href={prevHref} scroll={false} className="btn btn-secondary btn-sm btn-icon" aria-label={week ? 'Minggu sebelumnya' : 'Bulan sebelumnya'}><ChevronLeft size={16} /></Link>
                <Link href={week ? `/kalender?tampilan=minggu` : '/kalender'} scroll={false} className="btn btn-secondary btn-sm">Hari ini</Link>
                <Link href={nextHref} scroll={false} className="btn btn-secondary btn-sm btn-icon" aria-label={week ? 'Minggu berikutnya' : 'Bulan berikutnya'}><ChevronRight size={16} /></Link>
              </div>
            </div>
          </div>

          {week ? (
            <div className="cal-week" role="grid" aria-label={`Kalender minggu ${title}`}>
              {gridDays.map((d, i) => {
                const list = byDay.get(d) ?? []
                return (
                  <div key={d} role="gridcell" className={`cal-wday${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}`}>
                    <Link href={dayHref(d)} scroll={false} className="cal-whead" aria-label={`${formatDayLong(d)}, ${list.length} agenda`}>
                      <span className="cal-wdow">{DOW[i]}</span><span className="cal-num">{Number(d.slice(8))}</span>
                    </Link>
                    <div className="cal-wlist">
                      {list.length === 0 ? <span className="cal-wempty">—</span> : list.map((e) => chip(e, true))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="cal" role="grid" aria-label={`Kalender ${title}`}>
              {DOW.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
              {gridDays.map((d) => {
                const list = byDay.get(d) ?? []
                return (
                  <div key={d} role="gridcell" className={`cal-day${d.startsWith(month) ? '' : ' out'}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}`}>
                    <Link href={dayHref(d)} scroll={false} className="cal-hit" aria-label={`${formatDayLong(d)}, ${list.length} agenda`} />
                    <span className="cal-num">{Number(d.slice(8))}</span>
                    <div className="cal-evs">
                      {list.slice(0, 3).map((e) => chip(e))}
                      {list.length > 3 && <span className="cal-more">+{list.length - 3} lagi</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="cal-legend" aria-label="Keterangan warna">
            {LEGEND.map((l) => <span key={l.label}><span className="swatch" style={{ background: l.color }} />{l.label}</span>)}
          </div>
        </section>

        <aside id="panel-hari" className="card cal-side" aria-labelledby="day-title">
          <DayFocus sel={sel} target="panel-hari" />
          <div className="card-header">
            <div className="min-w-0">
              <p className="text-overline">{sel === today ? 'Hari ini' : sel === addDays(today, 1) ? 'Besok' : sel === addDays(today, -1) ? 'Kemarin' : 'Tanggal terpilih'}</p>
              <h2 id="day-title" className="text-[var(--text-heading)]">{formatDayLong(sel)}</h2>
            </div>
            {selEvents.length > 0 && <span className="badge">{selEvents.length} agenda</span>}
          </div>
          {selEvents.length === 0 ? (
            <EmptyState icon={<ListChecks size={20} strokeWidth={1.75} />} title="Tidak ada agenda" description="Tanggal ini masih kosong." />
          ) : (
            <div className="card-body py-1"><ul className="items">
              {selEvents.map((e) => (
                <li key={`${e.id}-s`} className={`item agenda-item${e.done ? ' is-done' : ''}`}>
                  <span className="swatch shrink-0 mt-1.5" style={{ background: e.color }} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <Link href={e.href} className="item-title block truncate hover:text-[var(--brand)]">{e.title}</Link>
                    <span className="item-meta">{e.kind}{e.time ? ` · ${e.time}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul></div>
          )}
          <div className="card-foot">
            <NewTaskButton key={sel} options={options} preset={{ kind: 'kegiatan', start_local: `${sel}T09:00` }} label="Kegiatan di tanggal ini" className="btn btn-secondary btn-block" />
          </div>
        </aside>
      </div>
    </div>
  )
}
