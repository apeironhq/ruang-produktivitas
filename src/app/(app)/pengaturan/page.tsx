import type { Metadata } from 'next'
import { Download, KeyRound, LogOut, ShieldCheck, User } from 'lucide-react'
import { PageHead, tint } from '@/components/ui/display'
import { signOut } from '@/app/auth-actions'
import { getCurrentUser } from '@/lib/supabase/server'
import { PasswordForm, ProfileForm } from './SettingsForms'

export const metadata: Metadata = { title: 'Pengaturan' }

function SectionHead({ icon, title, desc, color = 'var(--brand)' }: { icon: React.ReactNode; title: string; desc: string; color?: string }) {
  return (
    <div className="card-header justify-start">
      <span className="tint-icon" style={tint(color)} aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1"><h2 className="text-[length:var(--fs-h3)]">{title}</h2><p className="text-caption">{desc}</p></div>
    </div>
  )
}

export default async function Page() {
  const user = (await getCurrentUser())!
  return (
    <div className="page">
      <PageHead title="Pengaturan" description="Profil, keamanan akun, dan data Anda." />
      <div className="row-2" style={{ alignItems: 'start' }}>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card">
            <SectionHead icon={<User size={19} />} title="Profil" desc="Nama dan zona waktu yang dipakai di seluruh aplikasi." />
            <div className="card-body"><ProfileForm name={user.displayName} timezone={user.timezone} email={user.email} /></div>
          </section>
          <section className="card">
            <SectionHead icon={<KeyRound size={19} />} title="Password" desc="Ganti password akun Anda." color="var(--c-lilac)" />
            <div className="card-body"><PasswordForm /></div>
          </section>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card">
            <SectionHead icon={<Download size={19} />} title="Ekspor data" desc="Unduh seluruh data Anda (JSON)." color="var(--c-peach)" />
            <div className="card-body">
              <p className="text-caption mb-4">Berisi profil, target, tahapan, kontribusi, bidang belajar, modul, sumber, sesi, tugas, subtugas, dan catatan.</p>
              <a href="/api/ekspor" className="btn btn-secondary btn-block" download><Download size={16} />Unduh data saya</a>
            </div>
          </section>
          <section className="card">
            <SectionHead icon={<ShieldCheck size={19} />} title="Privasi" desc="Data Anda hanya dapat diakses oleh akun Anda." color="var(--c-blue)" />
            <div className="card-body flex flex-col gap-3">
              <p className="text-caption">Setiap tabel dilindungi Row Level Security di database — pengguna lain tidak dapat membaca, mengubah, maupun menautkan data Anda.</p>
              <form action={signOut}><button type="submit" className="btn btn-danger-ghost btn-block"><LogOut size={16} />Keluar dari perangkat ini</button></form>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
