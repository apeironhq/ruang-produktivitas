'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zEnum, zOptDay, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { createClient } from '@/lib/supabase/server'

const STATUSES = ['rencana', 'aktif', 'ditunda', 'selesai', 'arsip'] as const

function revalidateProjects(id?: string | null) {
  revalidatePath('/proyek')
  if (id) revalidatePath(`/proyek/${id}`)
  revalidatePath('/')
  revalidatePath('/tugas')
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 50).map((l) => l.slice(0, 200))

export async function saveProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    id: zOptUuid,
    title: zText(160, 'Nama proyek'),
    description: zOptText(4000),
    status: zEnum(STATUSES, 'Status').default('aktif'),
    goal_id: zOptUuid,
    start_date: zOptDay,
    due_date: zOptDay,
    milestones: zOptText(8000),
  }).refine((v) => !v.start_date || !v.due_date || v.due_date >= v.start_date, { path: ['due_date'], message: 'Tenggat tidak boleh sebelum tanggal mulai.' }), formData)
  if (parsed.error) return parsed.error
  const { id, milestones, ...row } = parsed.data
  const supabase = await createClient()
  if (id) {
    const { error } = await supabase.from('projects').update(row).eq('id', id)
    if (error) return dbError(error)
    revalidateProjects(id)
    return ok('Proyek diperbarui.', id)
  }
  const { data, error } = await supabase.from('projects').insert(row).select('id').single()
  if (error) return dbError(error)
  const titles = lines(milestones)
  if (titles.length) {
    const { error: e2 } = await supabase.from('project_milestones').insert(titles.map((title, i) => ({ project_id: data.id, title, sort_order: i + 1 })))
    if (e2) return dbError(e2, 'Proyek tersimpan, tetapi tahapan gagal disimpan.')
  }
  revalidateProjects(data.id)
  return ok('Proyek dibuat.', data.id)
}

export async function setProjectStatus(id: string, status: string): Promise<ActionState> {
  const p = z.object({ id: zUuid, status: z.enum(STATUSES) }).safeParse({ id, status })
  if (!p.success) return fail('Status tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('projects').update({ status: p.data.status }).eq('id', p.data.id)
  if (error) return dbError(error)
  revalidateProjects(p.data.id)
  return ok(p.data.status === 'selesai' ? 'Proyek ditandai selesai.' : 'Status proyek diperbarui.')
}

export async function deleteProject(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateProjects()
  return ok('Proyek dihapus. Tugas & catatannya tetap ada.')
}

export async function addProjectMilestones(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ project_id: zUuid, titles: zText(8000, 'Tahapan'), due_date: zOptDay }), formData)
  if (parsed.error) return parsed.error
  const titles = lines(parsed.data.titles)
  const supabase = await createClient()
  const { data: last } = await supabase.from('project_milestones').select('sort_order').eq('project_id', parsed.data.project_id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const start = (last?.sort_order ?? 0) + 1
  const { error } = await supabase.from('project_milestones').insert(titles.map((title, i) => ({
    project_id: parsed.data.project_id, title, sort_order: start + i, due_date: titles.length === 1 ? parsed.data.due_date : null,
  })))
  if (error) return dbError(error)
  revalidateProjects(parsed.data.project_id)
  return ok(titles.length > 1 ? `${titles.length} tahapan ditambahkan.` : 'Tahapan ditambahkan.')
}

export async function setProjectMilestoneDone(id: string, projectId: string, done: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('project_milestones').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id)
  if (error) return dbError(error)
  revalidateProjects(projectId)
  return ok(done ? 'Tahapan selesai.' : 'Tahapan dibuka lagi.')
}

export async function deleteProjectMilestone(id: string, projectId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('project_milestones').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateProjects(projectId)
  return ok('Tahapan dihapus.')
}
