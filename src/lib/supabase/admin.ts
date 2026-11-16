import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * Klien service role — MELEWATI RLS. Hanya untuk webhook Telegram & cron pengingat,
 * yang tidak punya sesi pengguna. Setiap query WAJIB difilter user_id secara eksplisit.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_SECRET_KEY belum diatur.')
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return client
}
