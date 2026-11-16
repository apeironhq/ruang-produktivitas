'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zDay, zEnum, zOptText, zOptUuid, zUuid, type ActionState } from '@/lib/action'
import { parseIdNumber } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

const KINDS = ['catatan', 'harian', 'belajar', 'trading', 'pekerjaan', 'ide', 'khusus'] as const
const optNum = z.preprocess((v) => (v === '' || v == null ? null : parseIdNumber(v)), z.number().nullable())

function revalidateJournal(id?: string) {
  revalidatePath('/jurnal')
  if (id) revalidatePath(`/jurnal/${id}`)
  revalidatePath('/')
  revalidatePath('/target', 'layout')
}

const entrySchema = z.object({
  id: zOptUuid,
  kind: zEnum(KINDS, 'Jenis'),
  title: zOptText(200),
  content: zOptText(50000),
  entry_date: zDay,
  tags: zOptText(400),
  mood: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).max(5).nullable()),
  goal_id: zOptUuid,
  subject_id: zOptUuid,
  project_id: zOptUuid,
  task_id: zOptUuid,
  t_instrument: zOptText(60),
  t_strategy: zOptText(120),
  t_side: z.preprocess((v) => v ?? '', z.enum(['', 'beli', 'jual'])),
  t_entry: optNum,
  t_exit: optNum,
  t_fee: optNum,
  t_result: optNum,
  t_evaluation: zOptText(4000),
}).refine((v) => v.title.length > 0 || v.content.length > 0, { message: 'Isi judul atau isi catatan.', path: ['title'] })

export async function saveEntry(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(entrySchema, formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const tags = [...new Set(v.tags.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean).map((t) => t.slice(0, 40)))].slice(0, 20)
  const row = {
    kind: v.kind,
    title: v.title,
    content: v.content,
    entry_date: v.entry_date,
    tags,
    mood: v.kind === 'harian' ? v.mood : null,
    goal_id: v.goal_id,
    subject_id: v.subject_id,
    project_id: v.project_id,
    task_id: v.task_id,
    // Jurnal trading adalah catatan analisis — tidak pernah dicatat sebagai transaksi keuangan.
    trading: v.kind === 'trading' ? {
      instrument: v.t_instrument, strategy: v.t_strategy, side: v.t_side,
      entry_price: v.t_entry, exit_price: v.t_exit, fee: v.t_fee, result: v.t_result, evaluation: v.t_evaluation,
    } : null,
  }
  const supabase = await createClient()
  if (v.id) {
    const { error } = await supabase.from('journal_entries').update(row).eq('id', v.id)
    if (error) return dbError(error)
    revalidateJournal(v.id)
    return ok('Catatan disimpan.', v.id)
  }
  const { data, error } = await supabase.from('journal_entries').insert(row).select('id').single()
  if (error) return dbError(error)
  revalidateJournal(data.id)
  return ok('Catatan dibuat.', data.id)
}

export async function setArchived(id: string, archived: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('journal_entries').update({ is_archived: archived }).eq('id', id)
  if (error) return dbError(error)
  revalidateJournal(id)
  return ok(archived ? 'Catatan diarsipkan.' : 'Catatan dikembalikan dari arsip.')
}

export async function deleteEntry(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('journal_entries').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateJournal()
  return ok('Catatan dihapus.')
}
