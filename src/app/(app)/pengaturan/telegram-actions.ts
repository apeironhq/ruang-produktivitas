'use server'

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zCheckbox, type ActionState } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { telegramConfigured } from '@/lib/telegram'
import { TG_PROMPT_COOKIE } from '@/lib/telegram-prompt'

// Tanpa huruf/angka yang mirip (0/O, 1/I) agar mudah diketik.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** BT-01: kode tautan sekali pakai, berlaku 10 menit. Dibuat server (service role), tidak bisa dibuat dari browser. */
export async function createLinkCode(): Promise<{ code: string; expiresAt: string } | { error: string }> {
  if (!telegramConfigured()) return { error: 'Bot Telegram belum diaktifkan di server.' }
  const user = await getCurrentUser()
  if (!user) return { error: 'Sesi berakhir. Silakan masuk kembali.' }
  const db = createAdminClient()
  await db.from('telegram_link_codes').delete().eq('user_id', user.id).is('used_at', null)
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  for (let i = 0; i < 3; i++) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const { error } = await db.from('telegram_link_codes').insert({ code, user_id: user.id, expires_at: expiresAt })
    if (!error) return { code, expiresAt }
    if (error.code !== '23505') break
  }
  return { error: 'Gagal membuat kode. Coba lagi.' }
}

/* ---------- Ajakan menyambungkan Telegram setelah masuk ---------- */
// Cookie TG_PROMPT_COOKIE = sudah diputuskan (tersambung / ditunda / dimatikan) → layout tidak perlu query lagi.
type PromptPref = 'off' | { until: string } | undefined

async function savePrompt(pref: PromptPref) {
  const user = await getCurrentUser()
  if (!user) return false
  const supabase = await createClient()
  const { data: prof } = await supabase.from('profiles').select('notification_settings').eq('id', user.id).maybeSingle()
  const ns = { ...((prof?.notification_settings as Record<string, unknown>) ?? {}) }
  if (pref === undefined) delete ns.tg_prompt
  else ns.tg_prompt = pref
  const { error } = await supabase.from('profiles').update({ notification_settings: ns }).eq('id', user.id)
  return !error
}

async function setPromptCookie(maxAgeSec: number | null) {
  const jar = await cookies()
  if (maxAgeSec === null) jar.delete(TG_PROMPT_COOKIE)
  else jar.set(TG_PROMPT_COOKIE, '1', { maxAge: maxAgeSec, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

/** Dipakai popup untuk mengecek berkala apakah bot sudah menautkan akun. */
export async function checkTelegramConnected(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  const supabase = await createClient()
  const { data } = await supabase.from('telegram_connections').select('user_id').maybeSingle()
  if (data) await setPromptCookie(365 * 86_400)
  return !!data
}

/** "Nanti saja" → muncul lagi setelah 3 hari. */
export async function snoozeTelegramPrompt(): Promise<void> {
  const until = new Date(Date.now() + 3 * 86_400_000).toISOString()
  await savePrompt({ until })
  await setPromptCookie(3 * 86_400)
}

/** Nyalakan / matikan ajakan (dari popup "Jangan tampilkan lagi" atau dari Pengaturan). */
export async function setTelegramPrompt(on: boolean): Promise<ActionState> {
  if (!(await savePrompt(on ? undefined : 'off'))) return fail('Gagal menyimpan. Coba lagi.')
  await setPromptCookie(on ? null : 365 * 86_400)
  revalidatePath('/pengaturan')
  return ok(on ? 'Ajakan sambungkan Telegram dinyalakan.' : 'Ajakan sambungkan Telegram dimatikan.')
}

/** Layout sudah tahu ajakan tidak perlu tampil → simpan cookie selama `seconds` agar tidak query lagi. */
export async function rememberTelegramPromptDecided(seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  await setPromptCookie(Math.min(Math.floor(seconds), 30 * 86_400))
}

/** BT-09: putuskan bot dari akun. */
export async function unlinkTelegram(): Promise<ActionState> {
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { error } = await supabase.from('telegram_connections').delete().eq('user_id', user.id)
  if (error) return dbError(error)
  if (process.env.SUPABASE_SECRET_KEY) await createAdminClient().from('telegram_pending').delete().eq('user_id', user.id)
  revalidatePath('/pengaturan')
  return ok('Telegram diputus. Pengingat tidak dikirim lagi.')
}

export async function saveNotifications(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    digest: zCheckbox,
    digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam tidak valid.'),
    evening: zCheckbox,
    evening_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam tidak valid.'),
  }), formData)
  if (parsed.error) return parsed.error
  const user = await getCurrentUser()
  if (!user) return fail('Sesi berakhir. Silakan masuk kembali.')
  const supabase = await createClient()
  const { data: prof } = await supabase.from('profiles').select('notification_settings').eq('id', user.id).maybeSingle()
  const settings = { ...((prof?.notification_settings as object) ?? {}), digest: parsed.data.digest, digest_time: parsed.data.digest_time, evening: parsed.data.evening, evening_time: parsed.data.evening_time }
  const { error } = await supabase.from('profiles').update({ notification_settings: settings }).eq('id', user.id)
  if (error) return dbError(error)
  revalidatePath('/pengaturan')
  return ok('Preferensi pengingat disimpan.')
}
