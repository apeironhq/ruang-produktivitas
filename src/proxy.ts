import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Halaman yang boleh dibuka tanpa masuk.
// /tg = Mini App Telegram (autentikasi lewat initData Telegram, bukan cookie sesi).
const PUBLIC_PATHS = ['/masuk', '/daftar', '/lupa-password', '/auth', '/tg']

/**
 * Menyegarkan sesi Supabase di setiap request (cookie diperbarui) dan
 * mengarahkan pengunjung yang belum masuk ke /masuk. Otorisasi data tetap di RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // Jangan menaruh kode di antara createServerClient dan getClaims().
  const { data } = await supabase.auth.getClaims()
  const signedIn = !!data?.claims?.sub
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/masuk'
    url.search = path !== '/' ? `?next=${encodeURIComponent(path + request.nextUrl.search)}` : ''
    return redirectWithCookies(url, response)
  }
  if (signedIn && (path === '/masuk' || path === '/daftar')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return redirectWithCookies(url, response)
  }
  return response
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const res = NextResponse.redirect(url)
  from.cookies.getAll().forEach((c) => res.cookies.set(c))
  return res
}

export const config = {
  // api/telegram & api/cron: dipanggil mesin (Telegram, pg_cron) dengan header rahasia sendiri, tanpa sesi.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|fonts/|api/telegram/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)'],
}
