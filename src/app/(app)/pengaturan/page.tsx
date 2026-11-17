import type { Metadata } from 'next'
import { Bell, Download, KeyRound, LogOut, Send, ShieldCheck, Sparkles, User } from 'lucide-react'
import { PageHead, SectionHead } from '@/components/ui/display'
import { signOut } from '@/app/auth-actions'
import { formatDateTime } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { botUsername, telegramConfigured } from '@/lib/telegram'
import { PasswordForm, ProfileForm } from './SettingsForms'
import { AiCard } from './AiCard'
import { NotificationForm, TelegramLink } from './TelegramCard'

export const metadata: Metadata = { title: 'Pengaturan' }

const LOG_STATUS: Record<string, { label: string; color: string }> = {
  terkirim: { label: 'Terkirim', color: 'var(--ok)' },
  gagal: { label: 'Gagal', color: 'var(--err)' },
  dilewati: { label: 'Dilewati', color: 'var(--n-400)' },
}

export default async function Page() {
  const user = (await getCurrentUser())!
  const supabase = await createClient()
  const [conn, prof, logs, ai] = await Promise.all([
    supabase.from('telegram_connections').select('username, linked_at').maybeSingle(),
    supabase.from('profiles').select('notification_settings').eq('id', user.id).maybeSingle(),
    supabase.from('reminder_logs').select('id, kind, status, detail, created_at, task_id').order('created_at', { ascending: false }).limit(6),
    supabase.from('ai_settings').select('enabled, key_hint, updated_at, key_secret_id').maybeSingle(),
  ])
  const a = ai.data?.key_secret_id ? ai.data : null
  const ns = (prof.data?.notification_settings ?? {}) as { digest?: boolean; digest_time?: string; tg_prompt?: unknown }
  const c = conn.data
  return (
    <div className="page">
      <PageHead title="Pengaturan" description="Profil, keamanan akun, Telegram & pengingat, dan data Anda." />
      <div className="row-2" style={{ alignItems: 'start' }}>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="prof-title">
            <SectionHead id="prof-title" icon={<User size={18} />} title="Profil" desc="Nama dan zona waktu yang dipakai di seluruh aplikasi" />
            <div className="card-body"><ProfileForm name={user.displayName} timezone={user.timezone} email={user.email} /></div>
          </section>
          <section className="card" aria-labelledby="tg-title">
            <SectionHead id="tg-title" icon={<Send size={18} />} title="Bot Telegram" desc="Terima pengingat, lihat agenda, dan catat cepat dari Telegram" />
            <div className="card-body">
              <TelegramLink info={{
                configured: telegramConfigured(),
                bot: botUsername(),
                connection: c ? { username: c.username, linked_at: c.linked_at, linkedLabel: formatDateTime(c.linked_at, user.timezone) } : null,
                promptOn: ns.tg_prompt !== 'off',
              }} />
            </div>
          </section>
          <section className="card" aria-labelledby="ai-title" id="ai">
            <SectionHead id="ai-title" icon={<Sparkles size={18} />} title="Asisten AI" desc="Bot lebih pintar dengan AI Groq — memakai kunci API milik Anda sendiri (gratis)" />
            <div className="card-body">
              <AiCard telegram={!!c} info={a ? { enabled: a.enabled, hint: a.key_hint, updatedLabel: formatDateTime(a.updated_at, user.timezone) } : null} />
            </div>
          </section>
          <section className="card" aria-labelledby="pw-title">
            <SectionHead id="pw-title" icon={<KeyRound size={18} />} title="Password" desc="Ganti password akun Anda" />
            <div className="card-body"><PasswordForm /></div>
          </section>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="notif-title">
            <SectionHead id="notif-title" icon={<Bell size={18} />} title="Pengingat" desc={c ? 'Dikirim lewat Telegram' : 'Tautkan Telegram agar pengingat bisa dikirim'} />
            <div className="card-body flex flex-col gap-5">
              <NotificationForm digest={ns.digest !== false} digestTime={ns.digest_time ?? '07:00'} />
              {(logs.data ?? []).length > 0 && (
                <div className="form-section">
                  <p className="field-label mb-2">Pengiriman terakhir</p>
                  <ul className="flex flex-col gap-2">
                    {(logs.data ?? []).map((l) => {
                      const st = LOG_STATUS[l.status] ?? LOG_STATUS.dilewati!
                      return (
                        <li key={l.id} className="flex items-start gap-2.5">
                          <span className="log-dot mt-1.5" style={{ background: st.color }} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="text-label block">{l.kind === 'ringkasan' ? 'Ringkasan harian' : 'Pengingat tugas'} · {st.label}</span>
                            <span className="item-sub block truncate">{formatDateTime(l.created_at, user.timezone)}{l.detail ? ` · ${l.detail}` : ''}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="exp-title">
            <SectionHead id="exp-title" icon={<Download size={18} />} title="Ekspor data" desc="Unduh seluruh data Anda (JSON)" />
            <div className="card-body">
              <p className="text-caption mb-4">Berisi profil, target, tahapan, kontribusi, bidang belajar, modul, sumber, sesi, tugas, subtugas, catatan, kebiasaan, lencana, serta rekening, transaksi, kategori, anggaran, alokasi tabungan, dan riwayat pengingat.</p>
              <a href="/api/ekspor" className="btn btn-secondary btn-block" download><Download size={16} />Unduh data saya</a>
            </div>
          </section>
          <section className="card" aria-labelledby="priv-title">
            <SectionHead id="priv-title" icon={<ShieldCheck size={18} />} title="Privasi" desc="Data Anda hanya dapat diakses oleh akun Anda" />
            <div className="card-body flex flex-col gap-3">
              <p className="text-caption">Setiap tabel dilindungi Row Level Security di database — pengguna lain tidak dapat membaca, mengubah, maupun menautkan data Anda. Bot Telegram hanya melayani chat pribadi dari akun yang sudah ditautkan.</p>
              <form action={signOut}><button type="submit" className="btn btn-secondary btn-block is-danger"><LogOut size={16} />Keluar dari perangkat ini</button></form>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
