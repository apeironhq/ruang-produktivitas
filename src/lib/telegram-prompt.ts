import 'server-only'
import { cookies } from 'next/headers'
import { createClient } from './supabase/server'
import { botUsername, telegramConfigured } from './telegram'

/** Cookie: ajakan sambungkan Telegram sudah diputuskan (tersambung / ditunda / dimatikan). */
export const TG_PROMPT_COOKIE = 'rp_tg'

/** rememberSec > 0 → simpan cookie selama itu (lewati query di halaman berikutnya). */
export type TelegramPromptState =
  | { show: false; rememberSec: number }
  | { show: true; bot: string }

/**
 * Apakah popup "Sambungkan Telegram" perlu tampil setelah masuk?
 * Selama cookie ada → tidak ada query sama sekali (aplikasi tetap ringan).
 * Tanpa cookie → cek koneksi Telegram & preferensi di profil (lintas perangkat).
 */
export async function telegramPromptState(userId: string): Promise<TelegramPromptState> {
  if (!telegramConfigured()) return { show: false, rememberSec: 0 }
  const jar = await cookies()
  if (jar.get(TG_PROMPT_COOKIE)) return { show: false, rememberSec: 0 }
  const supabase = await createClient()
  const [{ data: conn }, { data: prof }] = await Promise.all([
    supabase.from('telegram_connections').select('user_id').maybeSingle(),
    supabase.from('profiles').select('notification_settings').eq('id', userId).maybeSingle(),
  ])
  const pref = (prof?.notification_settings as { tg_prompt?: 'off' | { until?: string } } | null)?.tg_prompt
  if (conn || pref === 'off') return { show: false, rememberSec: 30 * 86_400 }
  if (pref && typeof pref === 'object' && pref.until && pref.until > new Date().toISOString()) {
    return { show: false, rememberSec: Math.max(60, Math.floor((new Date(pref.until).getTime() - Date.now()) / 1000)) }
  }
  return { show: true, bot: botUsername() }
}
