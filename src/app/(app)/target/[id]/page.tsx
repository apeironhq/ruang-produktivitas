import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Archive, BookOpen, Check, CheckSquare, Flag, Gauge, History, Link2, RotateCcw, Trash2, TrendingUp, Trophy } from 'lucide-react'
import { ActionButton, ConfirmButton } from '@/components/ui/actions'
import { BackLink, DescCard, Badge, DetailTitle, EmptyState, ProgressBar, SectionHead, tint, InfoList, StatTile } from '@/components/ui/display'
import { NewJournalButton } from '../../jurnal/JournalForm'
import { AllocationButton } from '../../keuangan/FinanceForms'
import { deleteAllocation } from '../../keuangan/actions'
import { Rabbit } from 'lucide-react'
import type { Allocation } from '@/lib/types'
import { loadAccounts } from '@/lib/finance'
import { addDays, todayIn } from '@/lib/dates'
import { formatDateTime, formatDay, formatMetric, formatNumber } from '@/lib/format'
import { GOAL_STATUS, PRIORITY, PROGRESS_SOURCE, displayStatus } from '@/lib/labels'
import { GOAL_COLUMNS, loadLinkOptions, loadProgress, mergeProgress } from '@/lib/queries'
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
  // Satu putaran paralel: target, progres, tahapan, kontribusi, dan relasi sekaligus.
  const [{ data: raw }, progress, ms, ev, tasks, subjects, journals, options, accounts, allocs] = await Promise.all([
    supabase.from('goals').select(GOAL_COLUMNS).eq('id', id).maybeSingle(),
    loadProgress(supabase, id),
    supabase.from('goal_milestones').select('id, goal_id, title, threshold, reached_at').eq('goal_id', id).order('threshold'),
    supabase.from('goal_progress_events').select('id, goal_id, value, note, occurred_on, source_type, created_at').eq('goal_id', id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    supabase.from('tasks').select('id, title, status, kind, due_at').eq('goal_id', id).order('status').limit(100),
    supabase.from('learning_subjects').select('id, title, status').eq('goal_id', id),
    supabase.from('journal_entries').select('id, title, kind, entry_date').eq('goal_id', id).order('entry_date', { ascending: false }).limit(10),
    loadLinkOptions(supabase),
    loadAccounts(supabase, true),
    supabase.from('goal_allocations').select('id, goal_id, account_id, amount, occurred_on, note, created_at').eq('goal_id', id)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
  ])
  const allocations = (allocs.data ?? []) as Allocation[]
  const held: Record<string, number> = {}
  for (const a of allocations) held[a.account_id] = (held[a.account_id] ?? 0) + Number(a.amount)
  const activeAccounts = accounts.filter((a) => !a.is_archived)
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  if (!raw) notFound()
  const goal = mergeProgress([raw as Goal], progress)[0]!
  const milestones = (ms.data ?? []) as Milestone[]
  if (goal.direction === 'turun') milestones.reverse()
  const events = (ev.data ?? []) as GoalEvent[]
  const linkedTasks = (tasks.data ?? []) as Pick<Task, 'id' | 'title' | 'status' | 'kind' | 'due_at'>[]
  const n = goalNumbers(goal)
  const st = GOAL_STATUS[goal.status]!
  const alokasi = goal.progress_source === 'alokasi'
  const manual = goal.progress_source === 'manual'
  const valued = manual || alokasi
  const binary = goal.metric_type === 'biner'
  const today = todayIn(tz)
  const fmt = (v: number) => (valued ?formatMetric(v, goal.metric_type, goal.unit_label) : `${formatNumber(v)} ${goal.unit_label}`)
  // Statistik kontribusi (target manual): rata-rata 90 hari terakhir & perkiraan tanggal tercapai.
  const since = addDays(today, -90)
  const recent90 = events.filter((e) => e.occurred_on >= since).reduce((s, e) => s + Number(e.value), 0)
  const perMonth = recent90 / 3
  const biggest = events.length ? Math.max(...events.map((e) => Number(e.value))) : 0
  const remainingNum = Math.max(0, (goal.direction === 'turun' ? goal.current - goal.effTarget : goal.effTarget - goal.current))
  const eta = remainingNum > 0 && perMonth > 0 ? addDays(today, Math.ceil((remainingNum / perMonth) * 30.4)) : null
  const showStats = manual && !binary && events.length > 0 && goal.status === 'aktif'
  const initial: GoalFormValues = {
    id: goal.id, title: goal.title, description: goal.description, category: goal.category, metric_type: goal.metric_type, unit_label: goal.unit_label,
    direction: goal.direction, progress_source: goal.progress_source, start_value: String(goal.start_value), target_value: String(goal.target_value),
    priority: goal.priority, start_date: goal.start_date, due_date: goal.due_date ?? '',
  }

  return (
    <div className="page">
      <BackLink href="/target">Target Saya</BackLink>
      <div className="page-head">
        <DetailTitle title={goal.title} status={st}
          meta={[PROGRESS_SOURCE[goal.progress_source]!.label, goal.category, goal.due_date ? `Tenggat ${formatDay(goal.due_date)}` : null]} />
        <div className="control-row">
          {goal.status === 'aktif' && manual && !binary && <ContributionButton goalId={goal.id} metric={goal.metric_type} today={today} direction={goal.direction} />}
          {goal.status === 'aktif' && alokasi && <AllocationButton goalId={goal.id} accounts={activeAccounts} today={today} held={held} />}
          {goal.status === 'aktif' && manual && binary &&<ActionButton action={markBinaryDone.bind(null, goal.id)} className="btn btn-primary"><Check size={16} />Tandai tercapai</ActionButton>}
          <EditGoalButton initial={initial} />
          {goal.status === 'arsip' || goal.status === 'tercapai'
            ? <ActionButton action={setGoalStatus.bind(null, goal.id, 'aktif')}><RotateCcw size={16} />Aktifkan lagi</ActionButton>
            : <ActionButton action={setGoalStatus.bind(null, goal.id, 'arsip')} className="btn btn-secondary is-warn"><Archive size={16} />Arsipkan</ActionButton>}
          {goal.status === 'tercapai' && <ActionButton action={setGoalStatus.bind(null, goal.id, 'arsip')} className="btn btn-secondary is-warn"><Archive size={16} />Arsipkan</ActionButton>}
          <ConfirmButton action={deleteGoal.bind(null, goal.id)} redirect="/target" title="Hapus target?"
            message={`"${goal.title}" beserta tahapan dan riwayat kontribusinya akan dihapus. Tugas & bidang belajar yang tertaut tidak ikut terhapus.`}
            className="btn btn-secondary btn-icon is-danger" ariaLabel="Hapus target"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <DescCard text={goal.description} />

      {goal.status === 'tercapai' && (
        <div className="alert" role="status">
          <Trophy size={18} style={{ color: 'var(--c-peach)' }} />
          <span>Target tercapai pada <strong>{formatDateTime(goal.achieved_at, tz)}</strong>. Tercatat di <Link href="/pencapaian" className="link">Pencapaian</Link>.</span>
        </div>
      )}

      <div className="row-2 cols-even">
        <section className="card panel" aria-labelledby="prog-title">
          <SectionHead id="prog-title" icon={<Gauge size={18} />} title="Perkembangan" desc={PROGRESS_SOURCE[goal.progress_source]!.hint} />
          <div className="card-body flex flex-col gap-5">
            <div>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="kpi-value text-[2.25rem]">{formatNumber(goal.percent)}%</span>
                <span className="item-sub">{n.summary}</span>
              </div>
              <ProgressBar percent={goal.percent} label="Progres target" large />
            </div>
            <div className="stat-tiles auto">
              {valued && !binary && <StatTile label="Nilai awal" value={formatMetric(goal.effStart, goal.metric_type, goal.unit_label)} />}
              <StatTile label="Saat ini" value={n.current} />
              <StatTile label="Target" value={n.target} />
              <StatTile label="Sisa" value={n.remaining} tone={goal.percent >= 100 ? 'ok' : undefined} />
            </div>
            <InfoList items={[
              ['Periode', `${formatDay(goal.start_date)} – ${goal.due_date ? formatDay(goal.due_date) : 'tanpa tenggat'}`],
              ['Sumber progres', PROGRESS_SOURCE[goal.progress_source]?.label ?? '—'],
              ['Kategori', goal.category || '—'],
              ['Prioritas', PRIORITY[goal.priority]?.label ?? '—'],
            ]} />
          </div>
        </section>

        <section className="card panel" aria-labelledby="ms-title">
          <SectionHead id="ms-title" icon={<Flag size={18} />} title="Tahapan" desc={`${milestones.filter((m) => m.reached_at).length} dari ${milestones.length} tercapai`}>
            {!binary && <MilestoneButton goalId={goal.id} hint={manual ? `Dalam satuan target, mis. ${goal.metric_type === 'rupiah' ? '25.000.000' : '5'}` : `Jumlah ${goal.unit_label} selesai`} />}
          </SectionHead>
          <div className="card-body pt-2 flex-1 flex flex-col">
            {milestones.length === 0 ? <EmptyState icon={<Flag size={20} strokeWidth={1.75} />} title="Belum ada tahapan" description="Pecah target menjadi langkah yang bisa dirayakan." className="fill" /> : (
              <ul className="milestones">
                {milestones.map((m) => (
                  <li key={m.id} className={`ms${m.reached_at ? ' reached' : ''}`}>
                    <span className="ms-dot" aria-hidden="true">{m.reached_at && <Check size={13} strokeWidth={3} />}</span>
                    <div className="min-w-0 flex-1">
                      <span className="item-title block">{fmt(Number(m.threshold))}{m.title ? ` · ${m.title}` : ''}</span>
                      <span className="item-sub">{m.reached_at ? `Tercapai ${formatDateTime(m.reached_at, tz)}` : 'Belum tercapai'}</span>
                    </div>
                    <ConfirmButton action={deleteMilestone.bind(null, m.id, goal.id)} title="Hapus tahapan?" message={`Tahapan ${fmt(Number(m.threshold))} akan dihapus.`}
                      className="btn btn-ghost btn-sm btn-icon is-danger" ariaLabel="Hapus tahapan"><Trash2 size={15} /></ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
            {(() => {
              const next = milestones.find((m) => !m.reached_at)
              return milestones.length > 0 && (
                <div className="panel-foot">
                  <span>{next ? 'Tahapan berikutnya' : 'Semua tahapan tercapai'}</span>
                  {next && <strong className="truncate">{fmt(Number(next.threshold))}{next.title ? ` · ${next.title}` : ''}</strong>}
                </div>
              )
            })()}
          </div>
        </section>
      </div>

      <div className="row-2 cols-even">
        {alokasi ? (
          <section className="card" aria-labelledby="alloc-title">
            <SectionHead id="alloc-title" icon={<Rabbit size={18} />} title="Riwayat alokasi"
              desc="Dana tetap di rekening, ditandai untuk target ini — bukan pemasukan baru">
              {allocations.length > 0 && <span className="badge">{allocations.length} alokasi</span>}
            </SectionHead>
            {allocations.length === 0 ? (
              <EmptyState icon={<Rabbit size={20} strokeWidth={1.75} />} title="Belum ada alokasi"
                description={activeAccounts.length ? 'Sisihkan dana dari rekening untuk mulai melihat progres.' : 'Tambahkan rekening di menu Keuangan terlebih dahulu.'}
                action={activeAccounts.length ? undefined : <Link href="/keuangan/rekening" className="btn btn-secondary">Buka Keuangan</Link>} />
            ) : (
              <div className="table-wrap items-scroll" tabIndex={0} role="region" aria-label="Tabel alokasi">
                <table className="table table-stack">
                  <thead><tr><th>Tanggal</th><th>Rekening</th><th>Catatan</th><th className="num">Nilai</th><th><span className="sr-only">Aksi</span></th></tr></thead>
                  <tbody>
                    {allocations.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Tanggal" className="whitespace-nowrap">{formatDay(a.occurred_on)}</td>
                        <td data-label="Rekening" className="cell-primary">{accountName.get(a.account_id) ?? '—'}</td>
                        <td data-label="Catatan">{a.note || <span className="text-caption">—</span>}</td>
                        <td data-label="Nilai" className="num cell-strong" style={{ color: a.amount < 0 ? 'var(--err)' : 'var(--brand-ink)' }}>
                          {a.amount > 0 ? '+' : '−'}{formatMetric(Math.abs(a.amount), 'rupiah')}
                        </td>
                        <td data-label="" className="cell-actions">
                          <div className="flex justify-end">
                            <ConfirmButton action={deleteAllocation.bind(null, a.id, goal.id)} title="Hapus alokasi?" message="Progres target dihitung ulang tanpa alokasi ini. Saldo rekening tidak berubah."
                              className="btn btn-ghost btn-sm btn-icon is-danger" ariaLabel="Hapus alokasi"><Trash2 size={15} /></ConfirmButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : manual ? (
          <section className="card" aria-labelledby="hist-title">
            <SectionHead id="hist-title" icon={<History size={18} />} title="Riwayat kontribusi" desc="Setiap perubahan nilai tercatat dan bisa ditelusuri">
              {events.length > 0 && <span className="badge">{events.length} kontribusi</span>}
            </SectionHead>
            {events.length === 0 ? <EmptyState icon={<History size={20} strokeWidth={1.75} />} title="Belum ada kontribusi" description="Catat kontribusi pertama untuk mulai melihat progres." /> : (
              <div className="card-body py-1">
                <ul className="items items-scroll">
                  {events.map((e) => (
                    <li key={e.id} className="item">
                      <div className="min-w-0 flex-1">
                        <span className="item-title block truncate">{e.note || 'Kontribusi'}</span>
                        <span className="item-sub">{formatDay(e.occurred_on)}</span>
                      </div>
                      <span className="cell-strong whitespace-nowrap" style={{ color: e.value < 0 ? 'var(--err)' : 'var(--text-heading)' }}>{e.value > 0 ? '+' : '−'}{formatMetric(Math.abs(e.value), goal.metric_type, goal.unit_label)}</span>
                      <ConfirmButton action={deleteContribution.bind(null, e.id, goal.id)} title="Hapus kontribusi?" message="Nilai target akan dihitung ulang tanpa kontribusi ini."
                        className="btn btn-ghost btn-sm btn-icon is-danger -mr-2" ariaLabel="Hapus kontribusi"><Trash2 size={15} /></ConfirmButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {events.length > 0 && (() => {
              const total = events.reduce((n, e) => n + Number(e.value), 0)
              return <div className="card-foot"><span>Total kontribusi</span><strong style={{ color: total < 0 ? 'var(--err)' : undefined }}>{total > 0 ? '+' : total < 0 ? '−' : ''}{formatMetric(Math.abs(total), goal.metric_type, goal.unit_label)}</strong></div>
            })()}
          </section>
        ) : (
          <section className="card" aria-labelledby="src-title">
            <SectionHead id="src-title" icon={goal.progress_source === 'modul' ? <BookOpen size={18} /> : <CheckSquare size={18} />}
              title={goal.progress_source === 'modul' ? 'Bidang belajar tertaut' : 'Tugas tertaut'}
              desc={goal.progress_source === 'modul' ? 'Tautkan bidang belajar ke target ini dari halaman Ruang Belajar' : 'Tautkan tugas ke target ini saat membuat atau mengubah tugas'} />
            <div className="card-body pt-2">
              {goal.progress_source === 'modul' ? (
                (subjects.data ?? []).length === 0 ? <EmptyState icon={<BookOpen size={20} strokeWidth={1.75} />} title="Belum ada bidang belajar tertaut" action={<Link href="/belajar" className="btn btn-secondary">Buka Ruang Belajar</Link>} /> : (
                  <ul className="items items-scroll">{(subjects.data ?? []).map((s) => (
                    <li key={s.id} className="item"><span className="act-icon" style={tint('var(--c-blue)')}><BookOpen size={16} /></span>
                      <Link href={`/belajar/${s.id}`} className="item-title flex-1 hover:text-[var(--brand)]">{s.title}</Link></li>
                  ))}</ul>
                )
              ) : linkedTasks.length === 0 ? <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />} title="Belum ada tugas tertaut" action={<Link href="/tugas" className="btn btn-secondary">Buka Tugas</Link>} /> : (
                <ul className="items items-scroll">{linkedTasks.map((t) => (
                  <li key={t.id} className={`item${t.status === 'selesai' ? ' is-done' : ''}`}>
                    <Link href={`/tugas/${t.id}`} className="item-title flex-1 min-w-0 truncate hover:text-[var(--brand)]">{t.title}</Link>
                    <Badge tone={displayStatus(t).tone}>{displayStatus(t).label}</Badge>
                  </li>
                ))}</ul>
              )}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-4 min-w-0">
        {showStats && (
          <section className="card" aria-labelledby="stat-title">
            <SectionHead id="stat-title" icon={<TrendingUp size={18} />} title="Statistik kontribusi" desc="Dihitung dari 90 hari terakhir" />
            <div className="card-body">
              <InfoList items={[
                ['Rata-rata per bulan', perMonth > 0 ? fmt(Math.round(perMonth)) : '—'],
                ['Kontribusi terbesar', biggest > 0 ? fmt(biggest) : '—'],
                ['Sisa menuju target', fmt(remainingNum)],
                ['Perkiraan tercapai', eta ? <span key="eta">{formatDay(eta)}{goal.due_date ? <span className={eta <= goal.due_date ? 'up-text' : 'overdue'}> · {eta <= goal.due_date ? 'sebelum tenggat' : 'lewat tenggat'}</span> : null}</span> : '—'],
              ]} />
            </div>
          </section>
        )}
        <section className="card" aria-labelledby="rel-title">
          <SectionHead id="rel-title" icon={<Link2 size={18} />} title="Terkait" desc="Tugas & catatan yang ditautkan ke target ini">
            <NewJournalButton today={today} goals={options.goals} subjects={options.subjects} preset={{ goal_id: goal.id }} label="Catatan" className="btn btn-secondary btn-sm" />
          </SectionHead>
          <div className="card-body pt-2">
            {manual && linkedTasks.length > 0 && (
              <>
                <p className="text-overline mt-2 mb-1">Tugas</p>
                <ul className="items items-scroll mb-3">{linkedTasks.slice(0, 6).map((t) => (
                  <li key={t.id} className={`item${t.status === 'selesai' ? ' is-done' : ''}`}><Link href={`/tugas/${t.id}`} className="item-title truncate hover:text-[var(--brand)]">{t.title}</Link></li>
                ))}</ul>
              </>
            )}
            <p className="text-overline mt-2 mb-1">Catatan & jurnal</p>
            {(journals.data ?? []).length === 0 ? <p className="text-caption py-2">Belum ada catatan tertaut.</p> : (
              <ul className="items items-scroll">{(journals.data ?? []).map((j) => (
                <li key={j.id} className="item"><Link href={`/jurnal/${j.id}`} className="item-title flex-1 truncate hover:text-[var(--brand)]">{j.title || 'Tanpa judul'}</Link><span className="item-meta">{formatDay(j.entry_date)}</span></li>
              ))}</ul>
            )}
          </div>
        </section>
        </div>
      </div>
    </div>
  )
}
