import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Tautan dari email Supabase (konfirmasi daftar, atur ulang password).
 *
 * - token_hash + type (template email yang disarankan): diverifikasi di sini, bekerja di perangkat mana pun.
 * - code (alur PKCE bawaan): Supabase SUDAH memverifikasi email sebelum mengarahkan ke sini. Penukaran kode
 *   menjadi sesi butuh cookie dari browser tempat mendaftar — jika tautan dibuka di browser/aplikasi email lain,
 *   penukaran gagal walau email sudah terkonfirmasi. Dalam kasus itu pengguna cukup diminta masuk.
 * - error / error_code (mis. tautan kedaluwarsa atau sudah dipakai): diteruskan sebagai pesan yang jelas.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')
  const errorCode = searchParams.get('error_code') ?? searchParams.get('error')
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
  const isRecovery = type === 'recovery' || next.startsWith('/atur-password')

  const url = request.nextUrl.clone()
  url.search = ''
  const toLogin = (params: Record<string, string>) => {
    url.pathname = '/masuk'
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return NextResponse.redirect(url)
  }

  if (errorCode) {
    return toLogin({ galat: errorCode === 'otp_expired' ? 'kedaluwarsa' : 'tautan' })
  }

  const supabase = await createClient()
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (error) return toLogin({ galat: error.code === 'otp_expired' ? 'kedaluwarsa' : 'tautan' })
    url.pathname = next
    return NextResponse.redirect(url)
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      url.pathname = next
      return NextResponse.redirect(url)
    }
    // Email sudah diverifikasi Supabase; hanya sesi yang tidak bisa dibuat di browser ini.
    if (isRecovery) return toLogin({ galat: 'pemulihan-beda-browser' })
    return toLogin({ terkonfirmasi: '1' })
  }

  return toLogin({ galat: 'tautan' })
}
