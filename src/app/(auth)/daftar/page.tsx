import type { Metadata } from 'next'
import { SignUpForm } from '../AuthForms'

export const metadata: Metadata = { title: 'Daftar' }

export default function Page() {
  return <SignUpForm />
}
