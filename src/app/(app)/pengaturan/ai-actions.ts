'use server'

import { revalidatePath } from 'next/cache'
import { dbError, fail, ok, type ActionState } from '@/lib/action'
import { testAiEndpoint, testAiKey } from '@/lib/ai/client'
import { normalizeBaseUrl, publicEndpointError } from '@/lib/ai/endpoint'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

// Kunci Groq diawali "gsk_".
const KEY_RE = /^[A-Za-z0-9._-]{20,300}$/

/** Uji kunci ke Groq lalu simpan terenkripsi (Supabase Vault). Kunci tidak pernah dikirim balik ke browser. */
export async function saveAiKey(_: ActionState, formData: FormData): Promise<ActionState> {
  const key = String(formData.get('key') ?? '').trim()
  if (!KEY_RE.test(key)) return fail('Format kunci tidak valid.', { key: 'Tempel kunci API dari console.groq.com (diawali “gsk_”), tanpa spasi.' })
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const test = await testAiKey(key)
  if (!test.ok && test.kind !== 'kuota') return fail(test.error, { key: test.error })
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_save_key', { p_key: key })
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok(test.ok ? 'Kunci tersimpan. Asisten AI aktif.' : 'Kunci tersimpan, tetapi batas pemakaian Groq sedang tercapai — coba lagi nanti.')
}

const ENDPOINT_KEY_RE = /^[A-Za-z0-9._-]{8,300}$/
const MODEL_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/

/**
 * Endpoint kustom berformat OpenAI (mis. 9router): alamat HTTPS publik + kunci + nama model / combo.
 * Diuji dulu (daftar model + satu chat kecil) sebelum disimpan; kunci disimpan terenkripsi.
 */
export async function saveAiEndpoint(_: ActionState, formData: FormData): Promise<ActionState> {
  const rawUrl = String(formData.get('base_url') ?? '').trim()
  const key = String(formData.get('key') ?? '').trim()
  const model = String(formData.get('model') ?? '').trim()
  const errors: Record<string, string> = {}
  const url = normalizeBaseUrl(rawUrl)
  if (!rawUrl) errors.base_url = 'Isi alamat endpoint, mis. https://nama-anda.vercel.app/v1'
  else if (!url.ok) errors.base_url = url.error
  if (!ENDPOINT_KEY_RE.test(key)) errors.key = 'Tempel kunci API dari dashboard endpoint (tanpa spasi).'
  if (!MODEL_RE.test(model)) errors.model = 'Isi nama model atau combo persis seperti di dashboard endpoint.'
  if (Object.keys(errors).length || !url.ok) return fail('Periksa kembali isian Anda.', errors)
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const bad = await publicEndpointError(url.url)
  if (bad) return fail(bad, { base_url: bad })
  const test = await testAiEndpoint({ key, baseUrl: url.url, model })
  if (!test.ok && test.kind !== 'kuota') {
    const field = test.kind === 'kunci' ? 'key' : /model|combo|credentials|not found/i.test(test.error) ? 'model' : 'base_url'
    return fail(test.error, { [field]: test.error })
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_save_endpoint', { p_key: key, p_base_url: url.url, p_model: model })
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok(test.ok ? 'Endpoint tersimpan. Asisten AI aktif.' : 'Endpoint tersimpan, tetapi batas pemakaian sedang tercapai — coba lagi nanti.')
}

export async function setAiEnabled(on: boolean): Promise<ActionState> {
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_set_enabled', { p_on: on })
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok(on ? 'Asisten AI diaktifkan.' : 'Asisten AI dimatikan. Kunci tetap tersimpan.')
}

export async function setAiShareData(on: boolean): Promise<ActionState> {
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_set_share_data', { p_on: on })
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok(on ? 'Rupi boleh membaca & mengubah data Anda (dengan konfirmasi).' : 'Rupi tidak lagi membaca data Anda.')
}

export async function deleteAiKey(): Promise<ActionState> {
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_delete_key')
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok('Pengaturan AI dihapus. Asisten AI nonaktif.')
}
