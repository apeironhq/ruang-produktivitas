'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zEnum, zInt, zOptLocalDateTime, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { zonedToIso } from '@/lib/dates'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

const STATUSES = ['belum', 'dikerjakan', 'tertunda', 'selesai', 'dibatalkan'] as const

const taskSchema = z.object({
  id: zOptUuid,
  kind: zEnum(['tugas', 'kegiatan'] as const, 'Jenis'),
  title: zText(200, 'Judul'),
  description: zOptText(4000),
  category: zOptText(60),
  priority: zEnum(['rendah', 'sedang', 'tinggi', 'mendesak'] as const, 'Prioritas'),
  status: zEnum(STATUSES, 'Status').default('belum'),
  due_at: zOptLocalDateTime,
  start_at: zOptLocalDateTime,
  end_at: zOptLocalDateTime,
  location: zOptText(200),
  goal_id: zOptUuid,
  project_id: zOptUuid,
  subject_id: zOptUuid,
  checklist: zOptText(4000),
  recurrence: zEnum(['tidak', 'harian', 'mingguan', 'bulanan'] as const, 'Ulangi').default('tidak'),
  remind: z.preprocess((v) => (v === '' || v == null ? undefined : v), zInt(0, 10080, 'Pengingat').optional()).transform((v) => v ?? null),
}).superRefine((v, ctx) => {
  if (v.kind === 'kegiatan' && !v.start_at) ctx.addIssue({ code: 'custom', path: ['start_at'], message: 'Kegiatan wajib punya waktu mulai.' })
  if (v.start_at && v.end_at && v.end_at < v.start_at) ctx.addIssue({ code: 'custom', path: ['end_at'], message: 'Waktu selesai harus setelah waktu mulai.' })
  const anchor = v.kind === 'kegiatan' ? v.start_at : v.due_at || v.start_at
  if (v.remind !== null && !anchor) ctx.addIssue({ code: 'custom', path: ['remind'], message: v.kind === 'kegiatan' ? 'Isi waktu mulai agar bisa diingatkan.' : 'Isi tenggat atau waktu mulai agar bisa diingatkan.' })
  if (v.recurrence !== 'tidak' && !anchor) ctx.addIssue({ code: 'custom', path: ['recurrence'], message: 'Jadwal berulang perlu tenggat atau waktu mulai.' })
})

function revalidateTasks(id?: string | null) {
  revalidatePath('/tugas')
  if (id) revalidatePath(`/tugas/${id}`)
  revalidatePath('/')
  revalidatePath('/kalender')
  revalidatePath('/target', 'layout')
}

export async function saveTask(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(taskSchema, formData)
  if (parsed.error) return parsed.error
  const v = parsed.data
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const tz = user.timezone
  const row = {
    kind: v.kind,
    title: v.title,
    description: v.description,
    category: v.category,
    priority: v.priority,
    status: v.kind === 'kegiatan' && v.status === 'dikerjakan' ? 'belum' : v.status,
    due_at: v.kind === 'tugas' && v.due_at ? zonedToIso(v.due_at, tz) : null,
    start_at: v.start_at ? zonedToIso(v.start_at, tz) : null,
    end_at: v.end_at ? zonedToIso(v.end_at, tz) : null,
    location: v.kind === 'kegiatan' ? v.location : '',
    goal_id: v.goal_id,
    project_id: v.project_id,
    subject_id: v.subject_id,
    recurrence: v.recurrence,
    remind_before_minutes: v.remind,
  }
  const supabase = await createClient()
  if (v.id) {
    const { error } = await supabase.from('tasks').update(row).eq('id', v.id)
    if (error) return dbError(error)
    revalidateTasks(v.id)
    return ok(v.kind === 'kegiatan' ? 'Kegiatan diperbarui.' : 'Tugas diperbarui.', v.id)
  }
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
  if (error) return dbError(error)
  const items = v.checklist.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 50)
  if (items.length) {
    const { error: e2 } = await supabase.from('task_subtasks').insert(items.map((title, i) => ({ task_id: data.id, title: title.slice(0, 200), sort_order: i })))
    if (e2) return dbError(e2, 'Tugas tersimpan, tetapi daftar periksa gagal disimpan.')
  }
  revalidateTasks(data.id)
  return ok(v.kind === 'kegiatan' ? 'Kegiatan ditambahkan.' : 'Tugas ditambahkan.', data.id)
}

export async function setTaskStatus(id: string, status: string): Promise<ActionState> {
  const p = z.object({ id: zUuid, status: z.enum(STATUSES) }).safeParse({ id, status })
  if (!p.success) return fail('Status tidak valid.')
  const supabase = await createClient()
  const { data, error } = await supabase.from('tasks').update({ status: p.data.status }).eq('id', p.data.id).select('recurrence, next_spawned_at').maybeSingle()
  if (error) return dbError(error)
  revalidateTasks(p.data.id)
  if (p.data.status !== 'selesai') return ok('Status diperbarui.')
  // Tugas berulang: trigger DB membuat jadwal berikutnya tepat sekali (TG-06).
  // RETURNING dihitung sebelum trigger AFTER berjalan → baca ulang hanya untuk tugas berulang.
  let spawned = false
  if (data && data.recurrence !== 'tidak' && !data.next_spawned_at) {
    const { data: again } = await supabase.from('tasks').select('next_spawned_at').eq('id', p.data.id).maybeSingle()
    spawned = !!again?.next_spawned_at
  }
  // notify: centang optimistis biasanya diam; untuk tugas berulang beri tahu jadwal barunya.
  return spawned ? { ...ok('Selesai. Jadwal berikutnya sudah dibuat.'), notify: true } : ok('Ditandai selesai.')
}

export async function deleteTask(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateTasks()
  return ok('Dihapus.')
}

export async function addSubtask(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ task_id: zUuid, titles: zText(8000, 'Subtugas') }), formData)
  if (parsed.error) return parsed.error
  const titles = parsed.data.titles.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 50).map((s) => s.slice(0, 200))
  if (!titles.length) return fail('Periksa kembali isian yang ditandai.', { titles: 'Subtugas wajib diisi.' })
  const supabase = await createClient()
  const { count } = await supabase.from('task_subtasks').select('id', { count: 'exact', head: true }).eq('task_id', parsed.data.task_id)
  const { error } = await supabase.from('task_subtasks').insert(titles.map((title, i) => ({ task_id: parsed.data.task_id, title, sort_order: (count ?? 0) + i })))
  if (error) return dbError(error)
  revalidateTasks(parsed.data.task_id)
  return ok(titles.length > 1 ? `${titles.length} subtugas ditambahkan.` : 'Subtugas ditambahkan.')
}

export async function toggleSubtask(id: string, taskId: string, done: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('task_subtasks').update({ is_completed: done }).eq('id', id)
  if (error) return dbError(error)
  // Semua subtugas sudah dicentang → tugasnya otomatis ditandai selesai (bisa dibuka lagi kapan saja).
  if (done && zUuid.safeParse(taskId).success) {
    const { data: subs } = await supabase.from('task_subtasks').select('is_completed').eq('task_id', taskId)
    if (subs && subs.length > 0 && subs.every((x) => x.is_completed)) {
      const { data: closed } = await supabase.from('tasks').update({ status: 'selesai' }).eq('id', taskId).eq('kind', 'tugas')
        .in('status', ['belum', 'dikerjakan', 'tertunda']).select('id').maybeSingle()
      if (closed) {
        revalidateTasks(taskId)
        return { ...ok('Semua subtugas selesai — tugas otomatis ditandai selesai.'), notify: true }
      }
    }
  }
  revalidateTasks(taskId)
  return ok(done ? 'Subtugas selesai.' : 'Subtugas dibuka lagi.')
}

export async function deleteSubtask(id: string, taskId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('task_subtasks').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateTasks(taskId)
  return ok('Subtugas dihapus.')
}
