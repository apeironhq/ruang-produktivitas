import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { getCurrentUser } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/masuk')
  return <AppShell user={{ name: user.displayName, email: user.email }}>{children}</AppShell>
}
