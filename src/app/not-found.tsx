import Link from 'next/link'
import { AppLogo } from '@/components/shell/AppLogo'

export default function NotFound() {
  return (
    <div className="auth">
      <div className="auth-card card text-center">
        <div className="flex justify-center mb-5"><AppLogo size={44} /></div>
        <h1 className="mb-2">Halaman tidak ditemukan</h1>
        <p className="text-caption mb-6">Data mungkin sudah dihapus, atau tautannya keliru.</p>
        <Link href="/" className="btn btn-primary btn-lg btn-block">Kembali ke Beranda</Link>
      </div>
    </div>
  )
}
