'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zCheckbox, zDay, zEnum, zInt, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { createClient } from '@/lib/supabase/server'

function revalidateLearning(subjectId?: string | null) {
  revalidatePath('/belajar')
  if (subjectId) revalidatePath(`/belajar/${subjectId}`)
  revalidatePath('/')
  revalidatePath('/target', 'layout')
}

const lines = (s: string, max = 100) => s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, max).map((l) => l.slice(0, 200))

// ---------- Bidang belajar ----------
export async function saveSubject(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    id: zOptUuid,
    title: zText(120, 'Nama bidang'),
    description: zOptText(2000),
    goal_id: zOptUuid,
    status: zEnum(['aktif', 'selesai', 'arsip'] as const).default('aktif'),
    modules: zOptText(8000),
  }), formData)
  if (parsed.error) return parsed.error
  const { id, modules, ...row } = parsed.data
  const supabase = await createClient()
  if (id) {
    const { error } = await supabase.from('learning_subjects').update(row).eq('id', id)
    if (error) return dbError(error)
    revalidateLearning(id)
    return ok('Bidang belajar diperbarui.', id)
  }
  const { data, error } = await supabase.from('learning_subjects').insert(row).select('id').single()
  if (error) return dbError(error)
  const titles = lines(modules)
  if (titles.length) {
    const { error: e2 } = await supabase.from('learning_modules').insert(titles.map((title, i) => ({ subject_id: data.id, title, sort_order: i + 1 })))
    if (e2) return dbError(e2, 'Bidang tersimpan, tetapi daftar modul gagal disimpan.')
  }
  revalidateLearning(data.id)
  return ok('Bidang belajar dibuat.', data.id)
}

export async function deleteSubject(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_subjects').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateLearning()
  return ok('Bidang belajar dihapus.')
}

// ---------- Modul ----------
export async function addModules(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ subject_id: zUuid, titles: zText(8000, 'Nama modul') }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { data: last } = await supabase.from('learning_modules').select('sort_order').eq('subject_id', parsed.data.subject_id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const start = (last?.sort_order ?? 0) + 1
  const titles = lines(parsed.data.titles)
  const { error } = await supabase.from('learning_modules').insert(titles.map((title, i) => ({ subject_id: parsed.data.subject_id, title, sort_order: start + i })))
  if (error) return dbError(error)
  revalidateLearning(parsed.data.subject_id)
  return ok(titles.length > 1 ? `${titles.length} modul ditambahkan.` : 'Modul ditambahkan.')
}

export async function setModuleDone(id: string, subjectId: string, done: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_modules').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id)
  if (error) return dbError(error)
  revalidateLearning(subjectId)
  return ok(done ? 'Modul ditandai selesai.' : 'Modul dibuka lagi.')
}

export async function setModuleApplicable(id: string, subjectId: string, applicable: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_modules').update({ is_applicable: applicable }).eq('id', id)
  if (error) return dbError(error)
  revalidateLearning(subjectId)
  return ok(applicable ? 'Modul dihitung kembali.' : 'Modul dilewati (tidak dihitung dalam progres).')
}

export async function moveModule(id: string, subjectId: string, dir: -1 | 1): Promise<ActionState> {
  const supabase = await createClient()
  const { data } = await supabase.from('learning_modules').select('id, sort_order').eq('subject_id', subjectId).order('sort_order').order('created_at')
  const list = data ?? []
  const i = list.findIndex((m) => m.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return ok('')
  const [a, b] = [list[i]!, list[j]!]
  // Normalisasi urutan agar tukar posisi selalu jelas.
  const updates = list.map((m, k) => ({ id: m.id, sort_order: k + 1 }))
  updates[i]!.sort_order = j + 1
  updates[j]!.sort_order = i + 1
  for (const u of updates.filter((u) => u.id === a.id || u.id === b.id || list.find((m) => m.id === u.id)!.sort_order !== u.sort_order)) {
    const { error } = await supabase.from('learning_modules').update({ sort_order: u.sort_order }).eq('id', u.id)
    if (error) return dbError(error)
  }
  revalidateLearning(subjectId)
  return ok('Urutan diperbarui.')
}

export async function deleteModule(id: string, subjectId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_modules').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateLearning(subjectId)
  return ok('Modul dihapus.')
}

// ---------- Sumber ----------
export async function saveSource(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    id: zOptUuid,
    subject_id: zUuid,
    title: zText(200, 'Judul sumber'),
    source_type: zEnum(['tautan', 'buku', 'pdf', 'video', 'kursus', 'catatan'] as const, 'Jenis sumber'),
    url: zOptText(2000).refine((u) => !u || /^https?:\/\//i.test(u), 'Tautan harus diawali http:// atau https://'),
    position: zOptText(120),
    notes: zOptText(2000),
  }), formData)
  if (parsed.error) return parsed.error
  const { id, ...row } = parsed.data
  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('learning_sources').update(row).eq('id', id)
    : await supabase.from('learning_sources').insert(row)
  if (error) return dbError(error)
  revalidateLearning(row.subject_id)
  return ok(id ? 'Sumber diperbarui.' : 'Sumber ditambahkan.')
}

export async function deleteSource(id: string, subjectId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_sources').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateLearning(subjectId)
  return ok('Sumber dihapus.')
}

// ---------- Sesi belajar ----------
export async function logSession(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    subject_id: zUuid,
    source_id: zOptUuid,
    module_id: zOptUuid,
    session_date: zDay,
    duration_minutes: zInt(1, 1440, 'Durasi'),
    material: zOptText(200),
    position: zOptText(120),
    summary: zOptText(4000),
    obstacles: zOptText(2000),
    next_steps: zOptText(2000),
    complete_module: zCheckbox,
  }), formData)
  if (parsed.error) return parsed.error
  const { complete_module, ...row } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.from('learning_sessions').insert(row)
  if (error) return dbError(error)
  if (complete_module && row.module_id) {
    await supabase.from('learning_modules').update({ completed_at: new Date().toISOString() }).eq('id', row.module_id).is('completed_at', null)
  }
  revalidateLearning(row.subject_id)
  return ok(`Sesi ${row.duration_minutes} menit dicatat.`)
}

export async function deleteSession(id: string, subjectId: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('learning_sessions').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateLearning(subjectId)
  return ok('Sesi dihapus.')
}
