import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpen, Clock, ExternalLink, Library, ListChecks, Target, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ui/actions'
import { BackLink, DetailTitle, EmptyState, KpiCard, ProgressBar, SectionHead, tint } from '@/components/ui/display'
import { addDays, todayIn } from '@/lib/dates'
import { formatDay, formatDuration, formatNumber } from '@/lib/format'
import { SOURCE_TYPE, SUBJECT_STATUS } from '@/lib/labels'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import type { Module, Option, Session, Source, Subject } from '@/lib/types'
import { hrefWith, str } from '@/lib/url'
import { deleteSession, deleteSource, deleteSubject } from '../actions'
import { AddModulesButton, EditSubjectButton, ModuleList, SessionButton, SourceButton } from '../LearningForms'

export const metadata: Metadata = { title: 'Bidang belajar' }

const RANGES = [
  { key: '', label: '30 hari', days: 30 },
  { key: '7', label: '7 hari', days: 7 },
  { key: '90', label: '90 hari', days: 90 },
  { key: 'semua', label: 'Semua', days: 0 },
] as const

export default async function Page({ params, searchParams }: PageProps<'/belajar/[id]'>) {
  const { id } = await params
  const sp = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const today = todayIn(user.timezone)
  const range = RANGES.find((r) => r.key === str(sp.rentang)) ?? RANGES[0]

  let sessionsQ = supabase.from('learning_sessions').select('*').eq('subject_id', id).order('session_date', { ascending: false }).order('created_at', { ascending: false })
  if (range.days) sessionsQ = sessionsQ.gte('session_date', addDays(today, -(range.days - 1)))
  const [{ data: subjectRow }, mods, srcs, sess, goals, allMin] = await Promise.all([
    supabase.from('learning_subjects').select('*').eq('id', id).maybeSingle(),
    supabase.from('learning_modules').select('id, subject_id, title, sort_order, is_applicable, completed_at').eq('subject_id', id).order('sort_order').order('created_at'),
    supabase.from('learning_sources').select('*').eq('subject_id', id).order('updated_at', { ascending: false }),
    sessionsQ.limit(200),
    supabase.from('goals').select('id, title').neq('status', 'arsip').order('created_at', { ascending: false }),
    supabase.from('learning_sessions').select('duration_minutes').eq('subject_id', id),
  ])
  if (!subjectRow) notFound()
  const subject = subjectRow as Subject
  const modules = (mods.data ?? []) as Module[]
  const sources = (srcs.data ?? []) as Source[]
  const sessions = (sess.data ?? []) as Session[]
  const goalOptions = (goals.data ?? []) as Option[]
  const applicable = modules.filter((m) => m.is_applicable)
  const done = applicable.filter((m) => m.completed_at).length
  const pct = applicable.length ? (done / applicable.length) * 100 : 0
  const rangeMinutes = sessions.reduce((n, s) => n + s.duration_minutes, 0)
  const totalMinutes = (allMin.data ?? []).reduce((n, s) => n + s.duration_minutes, 0)
  const goal = goalOptions.find((g) => g.id === subject.goal_id)
  const sourceTitle = new Map(sources.map((s) => [s.id, s.title]))
  const moduleTitle = new Map(modules.map((m) => [m.id, m.title]))
  const bundle = [{ id: subject.id, title: subject.title, sources, modules: applicable }]
  const st = SUBJECT_STATUS[subject.status]!

  return (
    <div className="page">
      <BackLink href="/belajar">Ruang Belajar</BackLink>
      <div className="page-head">
        <DetailTitle title={subject.title} status={st} desc={subject.description}
          meta={[
            `${applicable.length} modul`,
            goal ? <Link href={`/target/${goal.id}`} className="inline-flex items-center gap-1"><Target size={13} aria-hidden="true" />{goal.title}</Link> : null,
          ]} />
        <div className="control-row">
          <SessionButton subjects={bundle} defaultSubjectId={subject.id} today={today} />
          <EditSubjectButton initial={{ id: subject.id, title: subject.title, description: subject.description, goal_id: subject.goal_id, status: subject.status }} goals={goalOptions} />
          <ConfirmButton action={deleteSubject.bind(null, subject.id)} redirect="/belajar" title="Hapus bidang belajar?"
            message={`"${subject.title}" beserta modul, sumber, dan seluruh riwayat sesinya akan dihapus permanen.`}
            className="btn btn-danger-ghost btn-icon" ariaLabel="Hapus bidang"><Trash2 size={16} /></ConfirmButton>
        </div>
      </div>

      <div className="kpis kpis-3">
        <KpiCard label="Progres modul" value={null} display={`${Math.round(pct)}%`} icon={<ListChecks size={20} strokeWidth={1.9} />} color="var(--c-blue)" caption={`${done} dari ${applicable.length} modul selesai`} />
        <KpiCard label="Total waktu belajar" value={totalMinutes} display={formatDuration(totalMinutes)} icon={<Clock size={20} strokeWidth={1.9} />} color="var(--c-peach)" caption={`${formatNumber((allMin.data ?? []).length)} sesi sejak awal`} />
        <KpiCard label="Sumber belajar" value={sources.length} icon={<Library size={20} strokeWidth={1.9} />} color="var(--c-lilac)" caption={sources[0]?.position ? `Posisi terakhir: ${sources[0].position}` : 'Tautan, buku, video, kursus'} />
      </div>

      <div className="row-2">
        <section className="card h-fit" aria-labelledby="mod-title">
          <SectionHead id="mod-title" icon={<ListChecks size={18} />} title="Modul & materi" desc={`${done} dari ${applicable.length} modul selesai`}>
            <AddModulesButton subjectId={subject.id} />
          </SectionHead>
          {modules.length === 0 ? <EmptyState icon={<ListChecks size={20} strokeWidth={1.75} />} title="Belum ada modul" description="Tambahkan daftar modul atau materi; progres dihitung dari modul yang selesai." /> : (
            <div className="card-body pt-3">
              <div className="mb-2"><ProgressBar percent={pct} label="Progres modul" /></div>
              <ModuleList subjectId={subject.id} modules={modules} />
            </div>
          )}
        </section>

        <section className="card h-fit" aria-labelledby="src-title">
          <SectionHead id="src-title" icon={<Library size={18} />} title="Sumber belajar" desc="Posisi terakhir ikut diperbarui dari sesi">
            <SourceButton subjectId={subject.id} />
          </SectionHead>
          <div className="card-body pt-1">
            {sources.length === 0 ? <EmptyState icon={<Library size={20} strokeWidth={1.75} />} title="Belum ada sumber" description="Dokumentasi, buku, PDF, video, atau kursus." /> : (
              <ul className="items">
                {sources.map((s) => (
                  <li key={s.id} className="item">
                    <span className="act-icon" style={tint('var(--c-lilac)')} aria-hidden="true"><BookOpen size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <span className="item-title block truncate">{s.title}</span>
                      <span className="item-sub block truncate">{SOURCE_TYPE[s.source_type]}{s.position ? ` · ${s.position}` : ''}</span>
                    </div>
                    {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm btn-icon" aria-label={`Buka ${s.title}`}><ExternalLink size={15} /></a>}
                    <SourceButton subjectId={subject.id} initial={s} />
                    <ConfirmButton action={deleteSource.bind(null, s.id, subject.id)} title="Hapus sumber?" message={`"${s.title}" akan dihapus. Sesi yang memakai sumber ini tetap tersimpan.`}
                      className="btn btn-ghost btn-sm btn-icon" ariaLabel={`Hapus sumber ${s.title}`}><Trash2 size={15} /></ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="ses-title">
        <SectionHead id="ses-title" icon={<Clock size={18} />} title="Riwayat sesi"
          desc={`${formatDuration(rangeMinutes)} dalam ${sessions.length} sesi · ${range.days ? `${range.days} hari terakhir` : 'sejak awal'}`}>
          <div className="seg" role="group" aria-label="Rentang waktu">
            {RANGES.map((r) => <Link key={r.key} href={hrefWith(`/belajar/${id}`, sp, { rentang: r.key || null })} className={range.key === r.key ? 'on' : ''} scroll={false}>{r.label}</Link>)}
          </div>
        </SectionHead>
        {sessions.length === 0 ? <EmptyState icon={<Clock size={20} strokeWidth={1.75} />} title="Belum ada sesi di rentang ini" description="Catat sesi belajar untuk membangun riwayat." /> : (
          <ul className="items">
            {sessions.map((s) => (
              <li key={s.id} className="px-5 py-4 border-b border-[var(--border)] last:border-0">
                <div className="flex items-start gap-3">
                  <span className="act-icon" style={tint('var(--c-peach)')} aria-hidden="true"><Clock size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="item-row">
                      <span className="item-title">{s.material || 'Sesi belajar'}</span>
                      <span className="item-meta">{formatDay(s.session_date)} · {formatDuration(s.duration_minutes)}</span>
                    </div>
                    <div className="meta-row mt-0.5">
                      {s.source_id && sourceTitle.get(s.source_id) && <span>{sourceTitle.get(s.source_id)}</span>}
                      {s.module_id && moduleTitle.get(s.module_id) && <span>Modul: {moduleTitle.get(s.module_id)}</span>}
                      {s.position && <span>Posisi: {s.position}</span>}
                    </div>
                    {(s.summary || s.obstacles || s.next_steps) && (
                      <dl className="dl mt-3">
                        {s.summary && <div className="col-span-full"><dt>Ringkasan</dt><dd className="prose-plain font-normal">{s.summary}</dd></div>}
                        {s.obstacles && <div><dt>Kendala</dt><dd className="prose-plain font-normal">{s.obstacles}</dd></div>}
                        {s.next_steps && <div><dt>Langkah berikutnya</dt><dd className="prose-plain font-normal">{s.next_steps}</dd></div>}
                      </dl>
                    )}
                  </div>
                  <ConfirmButton action={deleteSession.bind(null, s.id, subject.id)} title="Hapus sesi?" message="Sesi ini akan dihapus dari riwayat dan total durasi."
                    className="btn btn-ghost btn-sm btn-icon" ariaLabel="Hapus sesi"><Trash2 size={15} /></ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
