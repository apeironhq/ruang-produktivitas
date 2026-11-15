'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zDay, zEnum, zNumber, zOptDay, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { parseIdNumber } from '@/lib/format'
import { todayIn } from '@/lib/dates'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

function revalidateGoals(id?: string | null) {
  revalidatePath('/target')
  if (id) revalidatePath(`/target/${id}`)
  revalidatePath('/pencapaian')
  revalidatePath('/')
}

const goalSchema = z.object({
  id: zOptUuid,
  title: zText(160, 'Nama target'),
  description: zOptText(4000),
  category: zOptText(60),
  metric_type: zEnum(['rupiah', 'jumlah', 'durasi', 'persentase', 'biner'] as const, 'Satuan'),
  unit_label: zOptText(30),
  direction: zEnum(['naik', 'turun'] as const, 'Arah').default('naik'),
  progress_source: zEnum(['manual', 'modul', 'tugas'] as const, 'Sumber progres'),
  start_value: z.preprocess((v) => (v === '' || v == null ? '0' : v), zNumber('Nilai awal')),
  target_value: z.preprocess((v) => (v === '' || v == null ? '0' : v), zNumber('Nilai target')),
  priority: zEnum(['rendah', 'sedang', 'tinggi'] as const, 'Prioritas'),
  start_date: zDay,
  due_date: zOptDay,
  milestones: zOptText(500),
}).superRefine((v, ctx) => {
  if (v.progress_source === 'manual' && v.metric_type !== 'biner') {
    if (v.direction === 'naik' && !(v.target_value > v.start_value)) ctx.addIssue({ code: 'custom', path: ['target_value'], message: 'Nilai target harus lebih besar dari nilai awal.' })
    if (v.direction === 'turun' && !(v.target_value < v.start_value)) ctx.addIssue({ code: 'custom', path: ['target_value'], message: 'Untuk target menurun, nilai target harus lebih kecil dari nilai awal.' })
  }
  if (v.due_date && v.due_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'Tenggat tidak boleh sebelum tanggal mulai.' })
})

export async function saveGoal(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(goalSchema, formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const manual = v.progress_source === 'manual'
  const binary = v.metric_type === 'biner'
  const row = {
    title: v.title,
    description: v.description,
    category: v.category,
    metric_type: manual ? v.metric_type : 'jumlah',
    unit_label: manual ? v.unit_label : v.progress_source === 'modul' ? 'modul' : 'tugas',
    direction: manual && !binary ? v.direction : 'naik',
    progress_source: v.progress_source,
    start_value: manual && !binary ? v.start_value : 0,
    target_value: manual ? (binary ? 1 : v.target_value) : 0,
    priority: v.priority,
    start_date: v.start_date,
    due_date: v.due_date,
  }
  const supabase = await createClient()
  if (v.id) {
    const { error } = await supabase.from('goals').update(row).eq('id', v.id)
    if (error) return dbError(error)
    await supabase.rpc('sync_goal', { p_goal_id: v.id })
    revalidateGoals(v.id)
    return ok('Target diperbarui.', v.id)
  }
  const { data, error } = await supabase.from('goals').insert(row).select('id').single()
  if (error) return dbError(error)
  // Tahapan cepat: "25jt, 50jt" atau "25.000.000; 50.000.000" atau "3, 6, 9"
  const thresholds = v.milestones.split(/[;\n]|,(?!\d{3})/).map((s) => parseMilestone(s)).filter((n): n is number => n !== null).slice(0, 20)
  if (thresholds.length) {
    await supabase.from('goal_milestones').insert(thresholds.map((threshold) => ({ goal_id: data.id, threshold, title: '' })))
  }
  revalidateGoals(data.id)
  return ok('Target dibuat.', data.id)
}

function parseMilestone(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const m = /^([\d.,]+)\s*(jt|juta|rb|ribu|m|miliar)?$/.exec(s)
  if (!m) return null
  const base = parseIdNumber(m[1])
  if (base === null) return null
  const mult = m[2] === 'jt' || m[2] === 'juta' ? 1e6 : m[2] === 'rb' || m[2] === 'ribu' ? 1e3 : m[2] === 'm' || m[2] === 'miliar' ? 1e9 : 1
  return base * mult
}

export async function addContribution(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser()
  const parsed = parseForm(z.object({
    goal_id: zUuid,
    mode: zEnum(['tambah', 'kurang'] as const),
    amount: zNumber('Jumlah').refine((n) => n > 0, 'Jumlah harus lebih dari 0.'),
    note: zOptText(500),
    occurred_on: z.preprocess((v) => v || todayIn(user?.timezone), zDay),
  }), formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const supabase = await createClient()
  const { data: goal } = await supabase.from('goals').select('progress_source').eq('id', v.goal_id).maybeSingle()
  if (!goal) return fail('Target tidak ditemukan.')
  if (goal.progress_source !== 'manual') return fail('Progres target ini dihitung otomatis dari modul/tugas, bukan kontribusi manual.')
  const { error } = await supabase.from('goal_progress_events').insert({
    goal_id: v.goal_id, value: v.mode === 'kurang' ? -v.amount : v.amount, note: v.note, occurred_on: v.occurred_on,
  })
  if (error) return dbError(error)
  revalidateGoals(v.goal_id)
  return ok('Kontribusi dicatat.')
}

export async function markBinaryDone(goalId: string): Promise<ActionState> {
  if (!zUuid.safeParse(goalId).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goal_progress_events').insert({ goal_id: goalId, value: 1, note: 'Ditandai selesai' })
  if (error) return dbError(error)
  revalidateGoals(goalId)
  return ok('Target ditandai tercapai.')
}

export async function deleteContribution(id: string, goalId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goal_progress_events').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateGoals(goalId)
  return ok('Kontribusi dihapus.')
}

export async function addMilestone(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ goal_id: zUuid, title: zOptText(120), threshold: zNumber('Ambang') }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { error } = await supabase.from('goal_milestones').insert(parsed.data)
  if (error) return dbError(error)
  revalidateGoals(parsed.data.goal_id)
  return ok('Tahapan ditambahkan.')
}

export async function deleteMilestone(id: string, goalId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goal_milestones').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateGoals(goalId)
  return ok('Tahapan dihapus.')
}

export async function setGoalStatus(id: string, status: 'aktif' | 'arsip'): Promise<ActionState> {
  if (!zUuid.safeParse(id).success || !['aktif', 'arsip'].includes(status)) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goals').update(status === 'aktif' ? { status, achieved_at: null } : { status }).eq('id', id)
  if (error) return dbError(error)
  if (status === 'aktif') await supabase.rpc('sync_goal', { p_goal_id: id })
  revalidateGoals(id)
  return ok(status === 'arsip' ? 'Target diarsipkan.' : 'Target diaktifkan kembali.')
}

export async function deleteGoal(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateGoals()
  return ok('Target dihapus.')
}
