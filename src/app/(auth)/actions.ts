'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { fail, ok, parseForm, type ActionState } from '@/lib/action'
import { createClient } from '@/lib/supabase/server'

const emailSchema = z.email('Format email tidak valid.').trim().toLowerCase().max(254)
/** Teks galat field email bila sudah terdaftar — dipakai form untuk menampilkan tautan Masuk / Lupa password. */
const EMAIL_TERDAFTAR = 'Email ini sudah terdaftar.'
const EMAIL_TERDAFTAR_PESAN = 'Email ini sudah terdaftar. Silakan masuk, atau atur ulang password bila lupa.'
const passwordSchema = z.string().min(8, 'Password minimal 8 karakter.').max(72, 'Password maksimal 72 karakter.')

async function siteUrl() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

/** Hanya izinkan path internal ("/..."), cegah open redirect ("//evil.com"). */
function safeNext(raw: unknown) {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ email: emailSchema, password: z.string().min(1, 'Password wajib diisi.') }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    if (error.code === 'email_not_confirmed') return fail('Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk Anda.')
    return fail('Email atau password salah.')
  }
  redirect(safeNext(formData.get('next')))
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    display_name: z.string().trim().min(1, 'Nama wajib diisi.').max(80, 'Nama maksimal 80 karakter.'),
    email: emailSchema,
    password: passwordSchema,
  }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Ikut di token login → halaman tidak perlu query profil (lihat getCurrentUser).
      data: { display_name: parsed.data.display_name, timezone: 'Asia/Jakarta' },
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/`,
    },
  })
  if (error) {
    if (error.code === 'user_already_exists') return fail(EMAIL_TERDAFTAR_PESAN, { email: EMAIL_TERDAFTAR })
    if (error.code === 'weak_password') return fail('Password terlalu lemah. Gunakan kombinasi huruf dan angka.')
    console.error('[auth] signUp', error.code)
    return fail('Pendaftaran gagal. Coba lagi beberapa saat lagi.')
  }
  // Saat konfirmasi email aktif, Supabase TIDAK mengembalikan error untuk email yang sudah terdaftar
  // (mencegah penebakan email); tanda khasnya: user tanpa identitas. Diminta eksplisit agar pengguna diberi tahu.
  if (data.user && (data.user.identities?.length ?? 0) === 0) return fail(EMAIL_TERDAFTAR_PESAN, { email: EMAIL_TERDAFTAR })
  // Konfirmasi email nonaktif di proyek → sesi langsung aktif.
  if (data.session) redirect('/')
  return ok('Akun dibuat. Cek email Anda untuk tautan konfirmasi, lalu masuk.')
}

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ email: emailSchema }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/atur-password`,
  })
  // Selalu sama, agar tidak membocorkan apakah email terdaftar.
  return ok('Jika email terdaftar, tautan untuk mengatur ulang password sudah dikirim.')
}

export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: 'Konfirmasi password tidak sama.', path: ['confirm'] }), formData)
  if (parsed.error) return parsed.error
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    if (error.code === 'same_password') return fail('Password baru harus berbeda dari password lama.')
    if (error.code === 'weak_password') return fail('Password terlalu lemah.')
    return fail('Gagal mengubah password. Tautan mungkin sudah kedaluwarsa.')
  }
  return ok('Password berhasil diperbarui.')
}
