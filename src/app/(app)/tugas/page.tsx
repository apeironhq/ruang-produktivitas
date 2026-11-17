import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckSquare, Columns3, List } from 'lucide-react'
import { CountFoot, EmptyState, PageHead, SectionHead } from '@/components/ui/display'
import { ScrollRows } from '@/components/ui/ScrollRows'
import { FilterBar } from '@/components/ui/FilterBar'
import { ParamSelect, SearchParamInput } from '@/components/ui/filters'
import { addDays, startOfDayIso, todayIn } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { OPEN_STATUSES, PRIORITY, TASK_STATUS } from '@/lib/labels'
import { loadLinkOptions } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Task } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { NewTaskButton } from './TaskForm'
import { TaskCard, TaskRow, type TaskMeta } from './TaskItems'

export const metadata: Metadata = { title: 'Tugas & Kegiatan' }

const TABS = [
  { key: '', label: 'Aktif' },
  { key: 'hari-ini', label: 'Hari ini' },
  { key: 'terlambat', label: 'Terlambat' },
  { key: 'selesai', label: 'Selesai' },
  { key: 'semua', label: 'Semua' },
] as const

const TASK_COLS = 'id, kind, title, description, category, priority, status, due_at, start_at, end_at, location, completed_at, goal_id, project_id, subject_id, recurrence, remind_before_minutes, created_at'

export default async function Page({ searchParams }: PageProps<'/tugas'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const supabase = await createClient()
  const view = str(sp.tampilan) === 'papan' ? 'papan' : 'daftar'
  const tab = str(sp.tab)
  const kind = str(sp.jenis)
  const priority = str(sp.prioritas)
  const q = str(sp.q).slice(0, 100)

  const today = todayIn(tz)
  const dayStart = startOfDayIso(today, tz)
  const dayEnd = startOfDayIso(addDays(today, 1), tz)
  const nowIso = new Date().toISOString()
  const todayOr = `and(due_at.gte.${dayStart},due_at.lt.${dayEnd}),and(start_at.gte.${dayStart},start_at.lt.${dayEnd})`
  // "Aktif": tugas yang belum selesai + kegiatan yang belum lewat (kegiatan yang sudah lewat tidak menumpuk di sini).
  const activeOr = `kind.eq.tugas,end_at.gte.${nowIso},and(end_at.is.null,start_at.gte.${nowIso})`

  let query = supabase.from('tasks').select(TASK_COLS)
  if (view === 'papan') {
    query = query.eq('kind', 'tugas').neq('status', 'dibatalkan')
  } else {
    if (tab === '') query = query.in('status', [...OPEN_STATUSES]).or(activeOr)
    if (tab === 'hari-ini') query = query.or(todayOr)
    if (tab === 'terlambat') query = query.eq('kind', 'tugas').in('status', [...OPEN_STATUSES]).lt('due_at', nowIso)
    if (tab === 'selesai') query = query.eq('status', 'selesai')
    if (kind === 'tugas' || kind === 'kegiatan') query = query.eq('kind', kind)
  }
  if (priority && PRIORITY[priority]) query = query.eq('priority', priority)
  if (q) query = query.ilike('title', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
  query = tab === 'selesai'
    ? query.order('completed_at', { ascending: false, nullsFirst: false })
    : query.order('due_at', { ascending: true, nullsFirst: false }).order('start_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })

  const count = (b: ReturnType<typeof supabase.from>) => b.select('id', { count: 'exact', head: true })
  // Satu putaran paralel. Subtugas diambil sekaligus (bukan menunggu daftar tugas dulu); RLS membatasi ke milik sendiri.
  const [{ data, error }, options, cActive, cToday, cLate, { data: subs }] = await Promise.all([
    query.limit(300),
    loadLinkOptions(supabase),
    count(supabase.from('tasks')).in('status', [...OPEN_STATUSES]).or(activeOr),
    count(supabase.from('tasks')).or(todayOr),
    count(supabase.from('tasks')).eq('kind', 'tugas').in('status', [...OPEN_STATUSES]).lt('due_at', nowIso),
    supabase.from('task_subtasks').select('task_id, is_completed').limit(5000),
  ])
  const tasks = (data ?? []) as Task[]
  const counts: Record<string, number | null> = { '': cActive.count, 'hari-ini': cToday.count, terlambat: cLate.count }

  const goalTitle = new Map(options.goals.map((g) => [g.id, g.title]))
  const meta = new Map<string, TaskMeta>()
  for (const t of tasks) meta.set(t.id, { subDone: 0, subTotal: 0, goalTitle: t.goal_id ? goalTitle.get(t.goal_id) : undefined })
  for (const s of subs ?? []) {
    const m = meta.get(s.task_id)
    if (m) { m.subTotal++; if (s.is_completed) m.subDone++ }
  }

  const columns = (['belum', 'dikerjakan', 'tertunda', 'selesai'] as const).map((s) => ({
    status: s,
    items: tasks.filter((t) => t.status === s).slice(0, s === 'selesai' ? 20 : 100),
  }))

  return (
    <div className="page">
      <PageHead title="Tugas & Kegiatan" description="Tugas punya tenggat dan status; kegiatan punya jadwal. Keduanya tampil di Kalender."
        actions={
          <>
            <NewTaskButton options={options} preset={{ kind: 'kegiatan' }} label="Kegiatan" className="btn btn-secondary" />
            <NewTaskButton options={options} />
          </>
        } />

      {error && <p className="alert tone-err" role="alert">Gagal memuat data. Muat ulang halaman.</p>}

      {view === 'daftar' && (
        <nav className="tabs" aria-label="Saring status">
          {TABS.map((t) => (
            <Link key={t.key} href={hrefWith('/tugas', sp, { tab: t.key || null })} className={`tab${tab === t.key ? ' active' : ''}`} aria-current={tab === t.key ? 'page' : undefined}>
              {t.label}{counts[t.key] != null && <span className="tab-count">{formatNumber(counts[t.key])}</span>}
            </Link>
          ))}
        </nav>
      )}

      <section className="card" aria-labelledby="task-title">
        <SectionHead quiet id="task-title" icon={<CheckSquare size={18} />} title={view === 'papan' ? 'Papan tugas' : 'Daftar tugas & kegiatan'}
          desc={view === 'papan' ? 'Tugas dikelompokkan menurut status' : 'Centang lingkaran untuk menandai tugas selesai'}>
          <div className="seg" role="group" aria-label="Tampilan">
            <Link href={hrefWith('/tugas', sp, { tampilan: null })} className={view === 'daftar' ? 'on' : ''} aria-current={view === 'daftar' ? 'page' : undefined}><List size={15} />Daftar</Link>
            <Link href={hrefWith('/tugas', sp, { tampilan: 'papan', tab: null, jenis: null })} className={view === 'papan' ? 'on' : ''} aria-current={view === 'papan' ? 'page' : undefined}><Columns3 size={15} />Papan</Link>
          </div>
        </SectionHead>
        <FilterBar>
          <SearchParamInput label="Cari tugas" placeholder="Cari judul tugas atau kegiatan" />
          {view === 'daftar' && <ParamSelect param="jenis" label="Jenis" options={[{ value: '', label: 'Semua jenis' }, { value: 'tugas', label: 'Tugas' }, { value: 'kegiatan', label: 'Kegiatan' }]} />}
          <ParamSelect param="prioritas" label="Prioritas" options={[{ value: '', label: 'Semua prioritas' }, ...Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v.label }))]} />
        </FilterBar>

        {view === 'daftar' ? (
          tasks.length === 0 ? (
            <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />}
              title={q || priority || kind ? 'Tidak ada yang cocok' : tab === 'selesai' ? 'Belum ada yang selesai' : 'Belum ada tugas di sini'}
              description={q || priority || kind ? 'Coba ubah kata kunci atau saringan.' : 'Tambahkan tugas atau kegiatan pertama Anda.'}
              action={!q && !priority && !kind && tab !== 'selesai' ? <NewTaskButton options={options} /> : undefined} />
          ) : (
            <>
              <ul className="items">{tasks.map((t) => <TaskRow key={t.id} t={t} meta={meta.get(t.id)} tz={tz} />)}</ul>
              <CountFoot shown={tasks.length} noun="item" />
            </>
          )
        ) : (
          <div className="card-body">
            <div className="board" aria-label="Papan tugas">
              {columns.map((c) => (
                <section key={c.status} className="board-col" aria-label={TASK_STATUS[c.status]!.label}>
                  <div className="board-head">
                    <span className={`board-title ${TASK_STATUS[c.status]!.tone}`}>{TASK_STATUS[c.status]!.label}</span>
                    <span className="board-count">{c.items.length}</span>
                  </div>
                  {c.items.length === 0 ? <p className="board-empty">Belum ada tugas</p> : (
                    <ScrollRows rows={3} className="board-list">
                      {c.items.map((t) => <TaskCard key={t.id} t={t} meta={meta.get(t.id)} tz={tz} />)}
                    </ScrollRows>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
