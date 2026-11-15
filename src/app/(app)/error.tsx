'use client'

import { TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <section className="card">
      <div className="empty">
        <span className="empty-mark" style={{ color: 'var(--err)', borderColor: 'var(--err-border)' }} aria-hidden="true"><TriangleAlert size={20} /></span>
        <span className="empty-title">Terjadi kesalahan saat memuat halaman</span>
        <span className="empty-desc">Periksa koneksi Anda lalu coba lagi. Jika terus terjadi, muat ulang halaman.</span>
        <div className="empty-action"><button type="button" className="btn btn-primary" onClick={reset}>Coba lagi</button></div>
      </div>
    </section>
  )
}
