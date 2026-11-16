import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { getCurrentUser } from '@/lib/supabase/server'
import { telegramPromptState } from '@/lib/telegram-prompt'
import { TelegramPrompt } from './TelegramPrompt'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/masuk')
  // Ajakan sambungkan Telegram (tanpa query bila cookie keputusan sudah ada).
  const tg = await telegramPromptState(user.id)
  return (
    <AppShell user={{ name: user.displayName, email: user.email }}>
      {children}
      <TelegramPrompt state={tg} />
    </AppShell>
  )
}
