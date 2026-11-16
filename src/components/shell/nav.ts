import { BookOpen, CalendarDays, CheckSquare, LayoutDashboard, NotebookPen, Settings, Target, Trophy, Wallet, type LucideIcon } from 'lucide-react'

export interface NavItem { href: string; label: string; short?: string; icon: LucideIcon; desc: string }

export const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Ruang kerja',
    items: [
      { href: '/', label: 'Beranda', icon: LayoutDashboard, desc: 'Ringkasan hari ini & perkembangan' },
      { href: '/tugas', label: 'Tugas & Kegiatan', short: 'Tugas', icon: CheckSquare, desc: 'Tugas, subtugas & jadwal kegiatan' },
      { href: '/kalender', label: 'Kalender', icon: CalendarDays, desc: 'Tenggat tugas & jadwal kegiatan per bulan' },
      { href: '/target', label: 'Target Saya', short: 'Target', icon: Target, desc: 'Target, tahapan & kontribusi' },
      { href: '/keuangan', label: 'Keuangan', icon: Wallet, desc: 'Rekening, pemasukan, pengeluaran & anggaran' },
    ],
  },
  {
    title: 'Catatan & belajar',
    items: [
      { href: '/belajar', label: 'Ruang Belajar', short: 'Belajar', icon: BookOpen, desc: 'Bidang, sumber, modul & sesi belajar' },
      { href: '/jurnal', label: 'Catatan & Jurnal', short: 'Jurnal', icon: NotebookPen, desc: 'Catatan bebas, jurnal harian & trading' },
      { href: '/pencapaian', label: 'Pencapaian', icon: Trophy, desc: 'Riwayat target yang berhasil dicapai' },
    ],
  },
  {
    title: 'Akun',
    items: [
      { href: '/pengaturan', label: 'Pengaturan', icon: Settings, desc: 'Profil, zona waktu & password' },
    ],
  },
]

/** Menu bawah ponsel: 4 menu utama + "Lainnya". */
export const BOTTOM_ITEMS = ['/', '/tugas', '/belajar', '/target']

export const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

export function isActivePath(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
}
