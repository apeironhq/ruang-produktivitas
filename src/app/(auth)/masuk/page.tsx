import type { Metadata } from 'next'
import { SignInForm } from '../AuthForms'

export const metadata: Metadata = { title: 'Masuk' }

export default async function Page({ searchParams }: PageProps<'/masuk'>) {
  const q = await searchParams
  const next = typeof q.next === 'string' && q.next.startsWith('/') && !q.next.startsWith('//') ? q.next : '/'
  const notice = q.keluar === '1' ? 'Anda telah keluar.'
    : q.terkonfirmasi === '1' ? 'Email terkonfirmasi. Silakan masuk.'
    : q.galat === 'tautan' ? 'Tautan tidak valid atau sudah kedaluwarsa. Silakan coba lagi.'
    : ''
  return <SignInForm next={next} notice={notice} />
}
