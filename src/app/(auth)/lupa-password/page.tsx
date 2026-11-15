import type { Metadata } from 'next'
import { ForgotForm } from '../AuthForms'

export const metadata: Metadata = { title: 'Lupa password' }

export default function Page() {
  return <ForgotForm />
}
