import type { Metadata } from 'next'
import { Download, KeyRound, LogOut, ShieldCheck, User } from 'lucide-react'
import { PageHead, SectionHead } from '@/components/ui/display'
import { signOut } from '@/app/auth-actions'
import { getCurrentUser } from '@/lib/supabase/server'
import { PasswordForm, ProfileForm } from './SettingsForms'

export const metadata: Metadata = { title: 'Pengaturan' }

export default async function Page() {
  const user = (await getCurrentUser())!
  return (
    <div className="page">
      <PageHead title="Pengaturan" description="Profil, keamanan akun, dan data Anda." />
      <div className="row-2" style={{ alignItems: 'start' }}>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="prof-title">
            <SectionHead id="prof-title" icon={<User size={18} />} title="Profil" desc="Nama dan zona waktu yang dipakai di seluruh aplikasi" />
            <div className="card-body"><ProfileForm name={user.displayName} timezone={user.timezone} email={user.email} /></div>
          </section>
          <section className="card" aria-labelledby="pw-title">
            <SectionHead id="pw-title" icon={<KeyRound size={18} />} title="Password" desc="Ganti password akun Anda" />
            <div className="card-body"><PasswordForm /></div>
          </section>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="exp-title">
            <SectionHead id="exp-title" icon={<Download size={18} />} title="Ekspor data" desc="Unduh seluruh data Anda (JSON)" />
            <div className="card-body">
              <p className="text-caption mb-4">Berisi profil, target, tahapan, kontribusi, bidang belajar, modul, sumber, sesi, tugas, subtugas, dan catatan.</p>
              <a href="/api/ekspor" className="btn btn-secondary btn-block" download><Download size={16} />Unduh data saya</a>
            </div>
          </section>
          <section className="card" aria-labelledby="priv-title">
            <SectionHead id="priv-title" icon={<ShieldCheck size={18} />} title="Privasi" desc="Data Anda hanya dapat diakses oleh akun Anda" />
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
