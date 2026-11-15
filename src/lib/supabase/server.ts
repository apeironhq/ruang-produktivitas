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
 * Pengguna saat ini — diverifikasi lewat getClaims() (tanda tangan JWT dicek dengan JWKS),
 * di-cache per request sehingga layout & halaman tidak memanggil ulang.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return null
  const id = data.claims.sub
  const { data: profile } = await supabase.from('profiles').select('display_name, timezone').eq('id', id).maybeSingle()
  const email = typeof data.claims.email === 'string' ? data.claims.email : ''
  return {
    id,
    email,
    displayName: profile?.display_name || email.split('@')[0] || 'Pengguna',
    timezone: profile?.timezone || 'Asia/Jakarta',
  }
})
