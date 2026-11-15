'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, type ActionState } from '@/lib/action'
import { isValidTimeZone } from '@/lib/dates'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

export async function saveProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    display_name: z.string().trim().min(1, 'Nama wajib diisi.').max(80, 'Nama maksimal 80 karakter.'),
    timezone: z.string().refine(isValidTimeZone, 'Zona waktu tidak dikenal.'),
  }), formData)
  if (parsed.error) return parsed.error
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.from('profiles').update(parsed.data).eq('id', user.id)
  if (error) return dbError(error)
  // Salin ke user_metadata lalu segarkan sesi agar token baru langsung membawa nama & zona waktu.
  const { error: metaError } = await supabase.auth.updateUser({ data: parsed.data })
  if (!metaError) await supabase.auth.refreshSession()
  revalidatePath('/', 'layout')
  return ok('Profil disimpan.')
}
