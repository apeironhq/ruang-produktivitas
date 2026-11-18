import type { Metadata } from 'next'
import Link from 'next/link'
import { Bell, Download, Info, KeyRound, Send, Sparkles, User } from 'lucide-react'
import { PageHead, SectionHead } from '@/components/ui/display'
import { formatDateTime } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { botUsername, telegramConfigured } from '@/lib/telegram'
import { AiCard } from './AiCard'
import { SettingsNavScroll } from './SettingsNavScroll'
import { PasswordForm, ProfileForm } from './SettingsForms'
import { NotificationForm, TelegramLink } from './TelegramCard'

export const metadata: Metadata = { title: 'Pengaturan' }

/** Bagian halaman Pengaturan — dipilih lewat ?bagian=… agar bisa ditautkan (mis. dari bot). */
const SECTIONS = [
  { key: 'akun', label: 'Akun', icon: User },
  { key: 'notifikasi', label: 'Telegram & Pengingat', icon: Send },
  { key: 'ai', label: 'Asisten AI', icon: Sparkles },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

export default async function Page({ searchParams }: PageProps<'/pengaturan'>) {
  const sp = await searchParams
  const raw = typeof sp.bagian === 'string' ? sp.bagian : ''
  const section: SectionKey = SECTIONS.some((s) => s.key === raw) ? (raw as SectionKey) : 'akun'

  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const [conn, prof, ai] = await Promise.all([
    supabase.from('telegram_connections').select('username, linked_at').maybeSingle(),
    supabase.from('profiles').select('notification_settings').eq('id', user.id).maybeSingle(),
    supabase.from('ai_settings').select('enabled, key_hint, updated_at, key_secret_id, base_url, model, share_data').maybeSingle(),
  ])
  const ns = (prof.data?.notification_settings ?? {}) as { digest?: boolean; digest_time?: string; evening?: boolean; evening_time?: string; tg_prompt?: unknown }
  const c = conn.data
  const a = ai.data?.key_secret_id ? ai.data : null

  return (
    <div className="page">
      <PageHead title="Pengaturan" description="Akun, Telegram & pengingat, dan Asisten AI." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Bagian pengaturan">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const on = s.key === section
            return (
              <Link key={s.key} href={`/pengaturan?bagian=${s.key}`} scroll={false} className={`settings-link${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined}>
                <Icon size={16} aria-hidden="true" />
                <span>{s.label}</span>
                {s.key === 'ai' && a?.enabled && <span className="settings-dot" aria-label="aktif" />}
              </Link>
            )
          })}
        </nav>
        <SettingsNavScroll active={section} />

        <div className="settings-main">
          {section === 'akun' && (
            <>
              <section className="card" aria-labelledby="prof-title">
                <SectionHead id="prof-title" icon={<User size={18} />} title="Profil" desc="Nama dan zona waktu yang dipakai di seluruh aplikasi" />
                <div className="card-body"><ProfileForm name={user.displayName} timezone={user.timezone} email={user.email} /></div>
              </section>
              <div className="settings-stack">
                <section className="card" aria-labelledby="pw-title">
                  <SectionHead id="pw-title" icon={<KeyRound size={18} />} title="Password" desc="Ganti password akun Anda" />
                  <div className="card-body"><PasswordForm /></div>
                </section>
                <section className="card" aria-labelledby="exp-title">
                  <SectionHead id="exp-title" icon={<Download size={18} />} title="Ekspor data" desc="Unduh seluruh data Anda dalam satu file JSON" />
                  <div className="card-body">
                    <a href="/api/ekspor" className="btn btn-secondary" download><Download size={16} />Unduh data saya</a>
                  </div>
                </section>
              </div>
            </>
          )}

          {section === 'notifikasi' && (
            <>
              <section className="card" aria-labelledby="tg-title">
                <SectionHead id="tg-title" icon={<Send size={18} />} title="Bot Telegram" desc="Terima pengingat, lihat agenda, dan catat cepat dari Telegram" />
                <div className="card-body set-body">
                  <TelegramLink info={{
                    configured: telegramConfigured(),
                    bot: botUsername(),
                    connection: c ? { username: c.username, linked_at: c.linked_at, linkedLabel: formatDateTime(c.linked_at, user.timezone) } : null,
                    promptOn: ns.tg_prompt !== 'off',
                  }} />
                </div>
              </section>
              <section className="card" aria-labelledby="notif-title">
                <SectionHead id="notif-title" icon={<Bell size={18} />} title="Pengingat" desc={c ? 'Notifikasi otomatis yang dikirim lewat Telegram' : 'Aktif setelah Telegram tertaut'} />
                <div className="card-body set-body">
                  <NotificationForm digest={ns.digest !== false} digestTime={ns.digest_time ?? '07:00'} evening={ns.evening !== false} eveningTime={ns.evening_time ?? '19:00'} />
                </div>
              </section>
            </>
          )}

          {section === 'ai' && (
            <>
              <section className="card" aria-labelledby="ai-title">
                <SectionHead id="ai-title" icon={<Sparkles size={18} />} title="Asisten AI" desc="Endpoint AI pribadi berformat OpenAI, dengan kunci milik Anda" />
                <div className="card-body">
                  <AiCard telegram={!!c} info={a ? { enabled: a.enabled, hint: a.key_hint, baseUrl: a.base_url, model: a.model, shareData: a.share_data, updatedLabel: formatDateTime(a.updated_at, user.timezone) } : null} />
                </div>
              </section>
              <section className="card" aria-labelledby="ai-how-title">
                <SectionHead id="ai-how-title" icon={<Info size={18} />} title="Cara kerja" desc="Contoh pesan yang dipahami Asisten AI" />
                <div className="card-body flex flex-col gap-4">
                  <ul className="ai-examples">
                    <li><span className="ai-ex-q">“besok jam 9 rapat tim 1 jam di kantor”</span><span className="ai-ex-a">📅 Kegiatan · Besok 09.00 · 1 jam</span></li>
                    <li><span className="ai-ex-q">“tadi beli bensin 20rb sama makan 15rb”</span><span className="ai-ex-a">💸 2 pengeluaran · kategori ditebak</span></li>
                    <li><span className="ai-ex-q">“ingetin tiap hari jam 7 malam minum obat”</span><span className="ai-ex-a">🔔 Pengingat berulang · 19.00</span></li>
                  </ul>
                  <p className="text-caption">Tidak ada yang tersimpan sebelum Anda menekan <strong>Simpan</strong> di bot.</p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
