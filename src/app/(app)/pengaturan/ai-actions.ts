'use server'

import { revalidatePath } from 'next/cache'
import { dbError, fail, ok, type ActionState } from '@/lib/action'
import { testGeminiKey } from '@/lib/ai/gemini'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

// Kunci AI Studio lama ("AIza…") maupun format baru ("AQ.Ab8…", mengandung titik).
const KEY_RE = /^[A-Za-z0-9._-]{20,300}$/

/** Uji kunci ke Gemini lalu simpan terenkripsi (Supabase Vault). Kunci tidak pernah dikirim balik ke browser. */
export async function saveAiKey(_: ActionState, formData: FormData): Promise<ActionState> {
  const key = String(formData.get('key') ?? '').trim()
  if (!KEY_RE.test(key)) return fail('Format kunci tidak valid.', { key: 'Tempel kunci API dari Google AI Studio (diawali “AIza” atau “AQ.”), tanpa spasi.' })
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const test = await testGeminiKey(key)
  if (!test.ok && test.kind !== 'kuota') return fail(test.error, { key: test.error })
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_save_key', { p_key: key })
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok(test.ok ? 'Kunci tersimpan. Asisten AI aktif.' : 'Kunci tersimpan, tetapi kuota Gemini sedang habis — coba lagi nanti.')
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

export async function deleteAiKey(): Promise<ActionState> {
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('ai_delete_key')
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok('Kunci dihapus. Asisten AI nonaktif.')
}
