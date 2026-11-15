import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { cache } from 'react'

/** Klien Supabase untuk Server Component & Server Action. Memakai sesi pengguna (RLS berlaku). */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Dipanggil dari Server Component (tidak bisa menulis cookie). Aman: proxy.ts menyegarkan sesi.
          }
        },
      },
    },
  )
}

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  timezone: string
}

/**
 * Pengguna saat ini — diverifikasi lewat getClaims() (tanda tangan JWT ES256 dicek lokal dengan JWKS yang
 * di-cache), di-cache per request. Nama & zona waktu dibaca dari user_metadata di token (disinkronkan saat
 * daftar & saat profil disimpan) sehingga tidak ada query database di setiap halaman. Query profil hanya
 * dipakai sebagai cadangan untuk token lama yang belum membawa metadata.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return null
  const id = data.claims.sub
  const email = typeof data.claims.email === 'string' ? data.claims.email : ''
  const meta = (data.claims.user_metadata ?? {}) as { display_name?: unknown; timezone?: unknown }
  let displayName = typeof meta.display_name === 'string' ? meta.display_name : ''
  let timezone = typeof meta.timezone === 'string' ? meta.timezone : ''
  if (!displayName || !timezone) {
    const { data: profile } = await supabase.from('profiles').select('display_name, timezone').eq('id', id).maybeSingle()
    displayName ||= profile?.display_name ?? ''
    timezone ||= profile?.timezone ?? ''
  }
  return {
    id,
    email,
    displayName: displayName || email.split('@')[0] || 'Pengguna',
    timezone: timezone || 'Asia/Jakarta',
  }
})
