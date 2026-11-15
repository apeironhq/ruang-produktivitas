import type { Metadata } from 'next'
import { SignInForm } from '../AuthForms'

export const metadata: Metadata = { title: 'Masuk' }

export default async function Page({ searchParams }: PageProps<'/masuk'>) {
  const q = await searchParams
  const next = typeof q.next === 'string' && q.next.startsWith('/') && !q.next.startsWith('//') ? q.next : '/'
  const notice = q.keluar === '1' ? 'Anda telah keluar.'
    : q.terkonfirmasi === '1' ? 'Email Anda sudah terkonfirmasi. Silakan masuk dengan email dan password.'
    : q.galat === 'kedaluwarsa' ? 'Tautan sudah kedaluwarsa atau sudah pernah dipakai. Jika email sudah terkonfirmasi, langsung masuk saja.'
    : q.galat === 'pemulihan-beda-browser' ? 'Buka tautan atur ulang password di browser yang sama dengan tempat Anda memintanya, atau minta tautan baru.'
    : q.galat === 'tautan' ? 'Tautan tidak valid. Silakan coba lagi atau minta tautan baru.'
    : ''
  return <SignInForm next={next} notice={notice} />
}
