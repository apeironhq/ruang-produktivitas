'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { JOURNAL_KIND, MOOD } from '@/lib/labels'
import type { JournalEntry, Option } from '@/lib/types'
import { saveEntry } from './actions'

export interface EditorValues {
  id?: string
  kind: JournalEntry['kind']
  title: string
  content: string
  entry_date: string
  tags: string
  mood: number | null
  goal_id: string | null
  subject_id: string | null
  trading: JournalEntry['trading']
}

export function JournalEditor({ initial, goals, subjects, cancelHref }: { initial: EditorValues; goals: Option[]; subjects: Option[]; cancelHref: string }) {
  const router = useRouter()
  const [kind, setKind] = useState(initial.kind)
  const { state, formAction, errors } = useFormAction(saveEntry, { onSuccess: (s) => { if (s.id) router.push(`/jurnal/${s.id}`) } })
  const t = initial.trading ?? {}
  return (
    <form action={formAction} noValidate className="row-2" style={{ alignItems: 'start' }}>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <section className="card" aria-label="Isi catatan">
        <div className="card-body flex flex-col gap-4">
          <label htmlFor="title" className="sr-only">Judul</label>
          <input id="title" name="title" className="editor-title" defaultValue={initial.title} maxLength={200} placeholder="Judul catatan" autoFocus={!initial.id} />
          {errors.title && <p className="field-error -mt-2">{errors.title}</p>}
          <hr className="border-[var(--border)]" />
          <label htmlFor="content" className="sr-only">Isi</label>
          <textarea id="content" name="content" className="editor-body" defaultValue={initial.content} maxLength={50000}
            placeholder={kind === 'harian' ? 'Bagaimana hari ini? Apa yang disyukuri, dipelajari, dan direncanakan besok?' : 'Tulis di sini…'} />
        </div>
        {kind === 'trading' && (
          <div className="card-body border-t border-[var(--border)]">
            <h2 className="text-[length:var(--fs-h3)] mb-1">Detail trading</h2>
            <p className="text-caption mb-4">Catatan analisis saja — tidak dihitung sebagai pemasukan/pengeluaran.</p>
            <div className="form-grid form-grid-2">
              <Field label="Instrumen" name="t_instrument"><input id="t_instrument" name="t_instrument" className="input" defaultValue={t.instrument} maxLength={60} placeholder="Mis. BBCA, XAUUSD" /></Field>
              <Field label="Posisi" name="t_side">
                <select id="t_side" name="t_side" className="select" defaultValue={t.side ?? ''}><option value="">—</option><option value="beli">Beli / long</option><option value="jual">Jual / short</option></select>
              </Field>
              <Field label="Strategi" name="t_strategy" className="col-span-full"><input id="t_strategy" name="t_strategy" className="input" defaultValue={t.strategy} maxLength={120} placeholder="Mis. Breakout, support-resistance" /></Field>
              <Field label="Harga masuk" name="t_entry" error={errors.t_entry}><input id="t_entry" name="t_entry" inputMode="decimal" className="input" defaultValue={t.entry_price ?? ''} /></Field>
              <Field label="Harga keluar" name="t_exit" error={errors.t_exit}><input id="t_exit" name="t_exit" inputMode="decimal" className="input" defaultValue={t.exit_price ?? ''} /></Field>
              <Field label="Biaya" name="t_fee" error={errors.t_fee}><input id="t_fee" name="t_fee" inputMode="decimal" className="input" defaultValue={t.fee ?? ''} /></Field>
              <Field label="Hasil (laba/rugi)" name="t_result" error={errors.t_result} hint="Negatif bila rugi, mis. -150.000"><input id="t_result" name="t_result" inputMode="decimal" className="input" defaultValue={t.result ?? ''} /></Field>
              <Field label="Evaluasi" name="t_evaluation" className="col-span-full"><textarea id="t_evaluation" name="t_evaluation" className="textarea" rows={3} defaultValue={t.evaluation} maxLength={4000} placeholder="Apa yang berjalan baik? Apa yang perlu diperbaiki?" /></Field>
            </div>
          </div>
        )}
      </section>

      <aside className="card" aria-label="Pengaturan catatan">
        <div className="card-body form-stack">
          <Field label="Jenis" name="kind" hint={JOURNAL_KIND[kind]?.desc}>
            <select id="kind" name="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as EditorValues['kind'])}>
              {Object.entries(JOURNAL_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Tanggal" name="entry_date" error={errors.entry_date}>
            <input id="entry_date" name="entry_date" type="date" className={`input${errClass(errors, 'entry_date')}`} defaultValue={initial.entry_date} required />
          </Field>
          {kind === 'harian' && (
            <Field label="Suasana hati" name="mood">
              <select id="mood" name="mood" className="select" defaultValue={initial.mood ?? ''}>
                <option value="">—</option>
                {Object.entries(MOOD).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </select>
            </Field>
          )}
          <Field label="Tag" name="tags" hint="Pisahkan dengan koma, mis. nextjs, ide-bisnis">
            <input id="tags" name="tags" className="input" defaultValue={initial.tags} maxLength={400} />
          </Field>
          <Field label="Target terkait" name="goal_id">
            <select id="goal_id" name="goal_id" className="select" defaultValue={initial.goal_id ?? ''}>
              <option value="">— Tidak ada —</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </Field>
          <Field label="Bidang belajar" name="subject_id">
            <select id="subject_id" name="subject_id" className="select" defaultValue={initial.subject_id ?? ''}>
              <option value="">— Tidak ada —</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>
          {state && !state.ok && !state.errors && <p className="alert tone-err" role="alert">{state.message}</p>}
          <div className="flex gap-2">
            <Link href={cancelHref} className="btn btn-secondary flex-1">Batal</Link>
            <div className="flex-1 [&>button]:w-full"><SubmitButton>Simpan</SubmitButton></div>
          </div>
        </div>
      </aside>
    </form>
  )
}
