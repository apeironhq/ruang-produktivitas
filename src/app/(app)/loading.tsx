/** Skeleton netral saat pindah halaman: judul + satu kartu daftar (cocok untuk semua menu). */
export default function Loading() {
  return (
    <div className="page" role="status" aria-live="polite">
      <span className="sr-only">Memuat data…</span>
      <div><span className="skeleton block" style={{ width: 200, height: 26 }} /><span className="skeleton block mt-2" style={{ width: 300, height: 14 }} /></div>
      <div className="card">
        <div className="card-header"><span className="skeleton block" style={{ width: 180, height: 18 }} /></div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-6 items-center px-5 py-4 border-b border-[var(--border)] last:border-0">
            <span className="skeleton" style={{ width: '34%', height: 14 }} />
            <span className="skeleton" style={{ width: '22%', height: 14 }} />
            <span className="skeleton" style={{ width: '14%', height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
