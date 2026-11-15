import type { Metadata } from 'next'
import { ResetPasswordForm } from '../AuthForms'

export const metadata: Metadata = { title: 'Atur password' }

export default function Page() {
  return <ResetPasswordForm />
}
