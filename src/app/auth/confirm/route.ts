import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Tautan dari email Supabase (konfirmasi daftar, atur ulang password).
 * Mendukung token_hash (template email disarankan) maupun ?code= (PKCE).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
  const supabase = await createClient()

  let ok = false
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    ok = !error
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    ok = !error
  }
  const url = request.nextUrl.clone()
  url.search = ''
  if (ok) {
    url.pathname = next
  } else {
    url.pathname = '/masuk'
    url.searchParams.set('galat', 'tautan')
  }
  return NextResponse.redirect(url)
}
