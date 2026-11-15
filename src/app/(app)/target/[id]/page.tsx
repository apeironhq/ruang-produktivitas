import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, BookOpen, Check, CheckSquare, History, RotateCcw, Trash2, Trophy } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { BackLink, Badge, EmptyState, ProgressBar, tint } from '@/components/ui/display'
import { todayIn } from '@/lib/dates'
import { formatDateTime, formatDay, formatMetric, formatNumber } from '@/lib/format'
import { GOAL_STATUS, PRIORITY, PROGRESS_SOURCE, TASK_STATUS } from '@/lib/labels'
import { GOAL_COLUMNS, withProgress } from '@/lib/queries'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Goal, GoalEvent, Milestone, Task } from '@/lib/types'
import { deleteContribution, deleteGoal, deleteMilestone, markBinaryDone, setGoalStatus } from '../actions'
import { goalNumbers } from '../GoalCard'
import { ContributionButton, EditGoalButton, MilestoneButton, type GoalFormValues } from '../GoalForm'

export const metadata: Metadata = { title: 'Detail target' }

export default async function Page({ params }: PageProps<'/target/[id]'>) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = (await getCurrentUser())!
  const tz = user.timezone
  const supabase = await createClient()
  const { data: raw } = await supabase.from('goals').select(GOAL_COLUMNS).eq('id', id).maybeSingle()
  if (!raw) notFound()
  const [g] = await withProgress(supabase, [raw as Goal])
  const [ms, ev, tasks, subjects, journals] = await Promise.all([
    supabase.from('goal_milestones').select('id, goal_id, title, threshold, reached_at').eq('goal_id', id).order('threshold', { ascending: g!.direction !== 'turun' }),
    supabase.from('goal_progress_events').select('id, goal_id, value, note, occurred_on, source_type, created_at').eq('goal_id', id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    supabase.from('tasks').select('id, title, status, kind, due_at').eq('goal_id', id).order('status').limit(100),
    supabase.from('learning_subjects').select('id, title, status').eq('goal_id', id),
    supabase.from('journal_entries').select('id, title, kind, entry_date').eq('goal_id', id).order('entry_date', { ascending: false }).limit(10),
  ])
  const goal = g!
  const milestones = (ms.data ?? []) as Milestone[]
  const events = (ev.data ?? []) as GoalEvent[]
  const linkedTasks = (tasks.data ?? []) as Pick<Task, 'id' | 'title' | 'status' | 'kind' | 'due_at'>[]
  const n = goalNumbers(goal)
  const st = GOAL_STATUS[goal.status]!
  const manual = goal.progress_source === 'manual'
  const binary = goal.metric_type === 'biner'
  const today = todayIn(tz)
  const fmt = (v: number) => (manual ? formatMetric(v, goal.metric_type, goal.unit_label) : `${formatNumber(v)} ${goal.unit_label}`)
  const initial: GoalFormValues = {
    id: goal.id, title: goal.title, description: goal.description, category: goal.category, metric_type: goal.metric_type, unit_label: goal.unit_label,
    direction: goal.direction, progress_source: goal.progress_source, start_value: String(goal.start_value), target_value: String(goal.target_value),
    priority: goal.priority, start_date: goal.start_date, due_date: goal.due_date ?? '',
  }

  return (
    <div className="page">
      <BackLink href="/target">Target Saya</BackLink>
      <div className="page-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="badge">{PROGRESS_SOURCE[goal.progress_source]!.label}</span>
            {goal.category && <span className="tag">{goal.category}</span>}
          </div>
          <h1 className="break-words">{goal.title}</h1>
          {goal.description && <p className="text-caption mt-1 max-w-[70ch]">{goal.description}</p>}
        </div>
        <div className="control-row">
          {goal.status === 'aktif' && manual && !binary && <ContributionButton goalId={goal.id} metric={goal.metric_type} today={today} direction={goal.direction} />}
          {goal.status === 'aktif' && manual && binary && <ActionButton action={markBinaryDone.bind(null, goal.id)} className="btn btn-primary"><Check size={16} />Tandai tercapai</ActionButton>}
          <EditGoalButton initial={initial} />
          {goal.status === 'arsip' || goal.status === 'tercapai'
            ? <ActionButton action={setGoalStatus.bind(null, goal.id, 'aktif')}><RotateCcw size={16} />Aktifkan lagi</ActionButton>
            : <ActionButton action={setGoalStatus.bind(null, goal.id, 'arsip')}><Archive size={16} />Arsipkan</ActionButton>}
          {goal.status === 'tercapai' && <ActionButton action={setGoalStatus.bind(null, goal.id, 'arsip')}><Archive size={16} />Arsipkan</ActionButton>}
          <ConfirmButton action={deleteGoal.bind(null, goal.id)} redirect="/target" title="Hapus target?"
            message={`"${goal.title}" beserta tahapan dan riwayat kontribusinya akan dihapus. Tugas & bidang belajar yang tertaut tidak ikut terhapus.`}
            className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus target"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      {goal.status === 'tercapai' && (
        <div className="alert" role="status">
          <Trophy size={18} style={{ color: 'var(--c-peach)' }} />
          <span>Target tercapai pada <strong>{formatDateTime(goal.achieved_at, tz)}</strong>. Tercatat di <Link href="/pencapaian" className="link">Pencapaian</Link>.</span>
        </div>
      )}

      <div className="row-2">
        <section className="card panel" aria-labelledby="prog-title">
          <div className="panel-head">
            <div><h2 id="prog-title">Perkembangan</h2><p className="text-caption">{PROGRESS_SOURCE[goal.progress_source]!.hint}</p></div>
          </div>
          <div className="panel-body gap-5">
            <div>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="kpi-value text-[2.25rem]">{formatNumber(goal.percent)}%</span>
                <span className="item-sub">{n.current} dari {n.target}</span>
              </div>
              <ProgressBar percent={goal.percent} label="Progres target" large />
            </div>
            <dl className="dl">
              {manual && !binary && <div><dt>Nilai awal</dt><dd>{formatMetric(goal.effStart, goal.metric_type, goal.unit_label)}</dd></div>}
              <div><dt>Nilai saat ini</dt><dd>{n.current}</dd></div>
              <div><dt>Nilai target</dt><dd>{n.target}</dd></div>
              <div><dt>Sisa</dt><dd>{n.remaining}</dd></div>
              <div><dt>Periode</dt><dd>{formatDay(goal.start_date)} – {goal.due_date ? formatDay(goal.due_date) : 'tanpa tenggat'}</dd></div>
              <div><dt>Prioritas</dt><dd>{PRIORITY[goal.priority]?.label}</dd></div>
            </dl>
          </div>
        </section>

        <section className="card panel" aria-labelledby="ms-title">
          <div className="panel-head">
            <div><h2 id="ms-title">Tahapan</h2><p className="text-caption">{milestones.filter((m) => m.reached_at).length} dari {milestones.length} tercapai</p></div>
            {!binary && <MilestoneButton goalId={goal.id} hint={manual ? `Dalam satuan target, mis. ${goal.metric_type === 'rupiah' ? '25.000.000' : '5'}` : `Jumlah ${goal.unit_label} selesai`} />}
          </div>
          <div className="panel-body">
            {milestones.length === 0 ? <EmptyState title="Belum ada tahapan" description="Pecah target menjadi langkah yang bisa dirayakan." className="fill" /> : (
              <ul className="milestones">
                {milestones.map((m) => (
                  <li key={m.id} className={`ms${m.reached_at ? ' reached' : ''}`}>
                    <span className="ms-dot" aria-hidden="true">{m.reached_at && <Check size={13} strokeWidth={3} />}</span>
                    <div className="min-w-0 flex-1">
                      <span className="item-title block">{fmt(Number(m.threshold))}{m.title ? ` · ${m.title}` : ''}</span>
                      <span className="item-sub">{m.reached_at ? `Tercapai ${formatDateTime(m.reached_at, tz)}` : 'Belum tercapai'}</span>
                    </div>
                    <ConfirmButton action={deleteMilestone.bind(null, m.id, goal.id)} title="Hapus tahapan?" message={`Tahapan ${fmt(Number(m.threshold))} akan dihapus.`}
                      className="btn btn-ghost btn-sm btn-icon" ariaLabel="Hapus tahapan"><Trash2 size={15} /></ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="row-2">
        {manual ? (
          <section className="card" aria-labelledby="hist-title">
            <div className="card-header"><div><h2 id="hist-title" className="text-[length:var(--fs-h3)]">Riwayat kontribusi</h2><p className="text-caption">Setiap perubahan nilai tercatat dan bisa ditelusuri.</p></div></div>
            {events.length === 0 ? <EmptyState icon={<History size={20} strokeWidth={1.75} />} title="Belum ada kontribusi" description="Catat kontribusi pertama untuk mulai melihat progres." /> : (
              <div className="table-wrap" tabIndex={0}>
                <table className="table table-stack">
                  <thead><tr><th>Tanggal</th><th>Catatan</th><th className="num">Nilai</th><th><span className="sr-only">Aksi</span></th></tr></thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td data-label="Tanggal" className="whitespace-nowrap">{formatDay(e.occurred_on)}</td>
                        <td data-label="Catatan" className="cell-primary">{e.note || <span className="text-caption">—</span>}</td>
                        <td data-label="Nilai" className="num cell-strong" style={{ color: e.value < 0 ? 'var(--err)' : undefined }}>{e.value > 0 ? '+' : '−'}{formatMetric(Math.abs(e.value), goal.metric_type, goal.unit_label)}</td>
                        <td data-label="" className="cell-actions">
                          <div className="flex justify-end">
                            <ConfirmButton action={deleteContribution.bind(null, e.id, goal.id)} title="Hapus kontribusi?" message="Nilai target akan dihitung ulang tanpa kontribusi ini."
                              className="btn btn-ghost btn-sm btn-icon" ariaLabel="Hapus kontribusi"><Trash2 size={15} /></ConfirmButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="card" aria-labelledby="src-title">
            <div className="card-header"><div><h2 id="src-title" className="text-[length:var(--fs-h3)]">{goal.progress_source === 'modul' ? 'Bidang belajar tertaut' : 'Tugas tertaut'}</h2>
              <p className="text-caption">{goal.progress_source === 'modul' ? 'Tautkan bidang belajar ke target ini dari halaman Ruang Belajar.' : 'Tautkan tugas ke target ini saat membuat/mengubah tugas.'}</p></div></div>
            <div className="card-body pt-2">
              {goal.progress_source === 'modul' ? (
                (subjects.data ?? []).length === 0 ? <EmptyState icon={<BookOpen size={20} strokeWidth={1.75} />} title="Belum ada bidang belajar tertaut" action={<Link href="/belajar" className="btn btn-secondary">Buka Ruang Belajar</Link>} /> : (
                  <ul className="items">{(subjects.data ?? []).map((s) => (
                    <li key={s.id} className="item"><span className="act-icon" style={tint('var(--c-blue)')}><BookOpen size={16} /></span>
                      <Link href={`/belajar/${s.id}`} className="item-title flex-1 hover:text-[var(--brand)]">{s.title}</Link></li>
                  ))}</ul>
                )
              ) : linkedTasks.length === 0 ? <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />} title="Belum ada tugas tertaut" action={<Link href="/tugas" className="btn btn-secondary">Buka Tugas</Link>} /> : (
                <ul className="items">{linkedTasks.map((t) => (
                  <li key={t.id} className={`item${t.status === 'selesai' ? ' is-done' : ''}`}>
                    <Link href={`/tugas/${t.id}`} className="item-title flex-1 min-w-0 truncate hover:text-[var(--brand)]">{t.title}</Link>
                    <Badge tone={TASK_STATUS[t.status]!.tone}>{TASK_STATUS[t.status]!.label}</Badge>
                  </li>
                ))}</ul>
              )}
            </div>
          </section>
        )}

        <section className="card h-fit" aria-labelledby="rel-title">
          <div className="card-header"><h2 id="rel-title" className="text-[length:var(--fs-h3)]">Terkait</h2></div>
          <div className="card-body pt-2">
            {manual && linkedTasks.length > 0 && (
              <>
                <p className="text-overline mt-2 mb-1">Tugas</p>
                <ul className="items mb-3">{linkedTasks.slice(0, 6).map((t) => (
                  <li key={t.id} className={`item${t.status === 'selesai' ? ' is-done' : ''}`}><Link href={`/tugas/${t.id}`} className="item-title truncate hover:text-[var(--brand)]">{t.title}</Link></li>
                ))}</ul>
              </>
            )}
            <p className="text-overline mt-2 mb-1">Catatan & jurnal</p>
            {(journals.data ?? []).length === 0 ? <p className="text-caption py-2">Belum ada catatan tertaut.</p> : (
              <ul className="items">{(journals.data ?? []).map((j) => (
                <li key={j.id} className="item"><Link href={`/jurnal/${j.id}`} className="item-title flex-1 truncate hover:text-[var(--brand)]">{j.title || 'Tanpa judul'}</Link><span className="item-meta">{formatDay(j.entry_date)}</span></li>
              ))}</ul>
            )}
            <Link href={`/jurnal/baru?target=${goal.id}`} className="btn btn-secondary btn-sm mt-3">+ Tulis catatan</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
