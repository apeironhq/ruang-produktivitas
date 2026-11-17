import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, CheckSquare, FolderKanban, Milestone } from 'lucide-react'
import { Badge, EmptyState, PageHead, ProgressBar, SectionHead } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { formatDay, formatNumber } from '@/lib/format'
import { PROJECT_STATUS } from '@/lib/labels'
import { projectProgress } from '@/lib/projects'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Option, Project } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { NewProjectButton } from './ProjectForms'

export const metadata: Metadata = { title: 'Proyek Saya' }

const TABS = [
  { key: '', label: 'Berjalan', statuses: ['rencana', 'aktif', 'ditunda'] },
  { key: 'selesai', label: 'Selesai', statuses: ['selesai'] },
  { key: 'arsip', label: 'Diarsipkan', statuses: ['arsip'] },
] as const

export default async function Page({ searchParams }: PageProps<'/proyek'>) {
  const sp = await searchParams
  const user = (await getCurrentUser())!
  const today = todayIn(user.timezone)
  const tab = TABS.find((t) => t.key === str(sp.tab)) ?? TABS[0]
  const supabase = await createClient()
  const [projRes, taskRes, msRes, goalRes] = await Promise.all([
    supabase.from('projects').select('id, title, description, status, goal_id, start_date, due_date, created_at, updated_at').order('updated_at', { ascending: false }),
    supabase.from('tasks').select('project_id, status').not('project_id', 'is', null).limit(5000),
    supabase.from('project_milestones').select('project_id, completed_at').limit(5000),
    supabase.from('goals').select('id, title').neq('status', 'arsip').order('created_at', { ascending: false }),
  ])
  const projects = (projRes.data ?? []) as Project[]
  const goals = (goalRes.data ?? []) as Option[]
  const tasks = new Map<string, { done: number; total: number }>()
  for (const t of taskRes.data ?? []) {
    if (t.status === 'dibatalkan') continue
    const c = tasks.get(t.project_id) ?? { done: 0, total: 0 }
    c.total++; if (t.status === 'selesai') c.done++
    tasks.set(t.project_id, c)
  }
  const ms = new Map<string, { done: number; total: number }>()
  for (const m of msRes.data ?? []) {
    const c = ms.get(m.project_id) ?? { done: 0, total: 0 }
    c.total++; if (m.completed_at) c.done++
    ms.set(m.project_id, c)
  }
  const counts = Object.fromEntries(TABS.map((t) => [t.key, projects.filter((p) => (t.statuses as readonly string[]).includes(p.status)).length]))
  const shown = projects.filter((p) => (tab.statuses as readonly string[]).includes(p.status))
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]))
  const zero = { done: 0, total: 0 }

  return (
    <div className="page">
      <PageHead title="Proyek Saya" description="Kelompokkan tugas, tahapan, dan catatan; progres dihitung dari tugas atau tahapan proyek."
        actions={<NewProjectButton today={today} goals={goals} />} />

      <nav className="tabs" aria-label="Saring proyek">
        {TABS.map((t) => (
          <Link key={t.key} href={hrefWith('/proyek', sp, { tab: t.key || null })} className={`tab${tab.key === t.key ? ' active' : ''}`} aria-current={tab.key === t.key ? 'page' : undefined}>
            {t.label}<span className="tab-count">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      <section className="card" aria-labelledby="proj-title">
        <SectionHead id="proj-title" icon={<FolderKanban size={18} />} title={`Proyek ${tab.label.toLowerCase()}`}
          desc={tab.key === '' ? 'Rencana, berjalan, dan ditunda' : tab.key === 'selesai' ? 'Proyek yang sudah rampung' : 'Disimpan tanpa dipantau'}>
          {shown.length > 0 && <span className="badge">{shown.length} proyek</span>}
        </SectionHead>
        {shown.length === 0 ? (
          <EmptyState icon={<FolderKanban size={20} strokeWidth={1.75} />} title={tab.key === '' ? 'Belum ada proyek berjalan' : tab.key === 'selesai' ? 'Belum ada proyek selesai' : 'Tidak ada proyek diarsipkan'}
            description={tab.key === '' ? 'Contoh: Aplikasi Ruang Produktivitas v1, Skripsi, Renovasi rumah.' : undefined}
            action={tab.key === '' ? <NewProjectButton today={today} goals={goals} /> : undefined} />
        ) : (
          <div className="card-body">
            <div className="grid-cards">
              {shown.map((p) => {
                const t = tasks.get(p.id) ?? zero
                const m = ms.get(p.id) ?? zero
                const prog = projectProgress(t, m)
                const st = PROJECT_STATUS[p.status]!
                const late = p.due_date && p.due_date < today && p.status !== 'selesai'
                return (
                  <Link key={p.id} href={`/proyek/${p.id}`} className="card kpi clickable" aria-label={`${p.title}, progres ${Math.floor(prog.pct)}%`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate">{p.title}</h3>
                        <p className="item-sub mt-0.5 truncate">{p.goal_id && goalTitle.get(p.goal_id) ? `Target: ${goalTitle.get(p.goal_id)}` : p.description || 'Tanpa deskripsi'}</p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="kpi-value text-[1.5rem]">{formatNumber(Math.floor(prog.pct))}%</span>
                        <span className="item-sub text-right">{prog.label}</span>
                      </div>
                      <ProgressBar percent={prog.pct} label={`Progres ${p.title}`} />
                    </div>
                    <div className="meta-row justify-between">
                      <span className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1"><CheckSquare size={13} aria-hidden="true" />{t.done}/{t.total} tugas</span>
                        <span className="inline-flex items-center gap-1"><Milestone size={13} aria-hidden="true" />{m.done}/{m.total} tahapan</span>
                      </span>
                      {p.due_date && <span className={late ? 'overdue' : ''}><CalendarDays size={13} aria-hidden="true" />{formatDay(p.due_date)}</span>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
