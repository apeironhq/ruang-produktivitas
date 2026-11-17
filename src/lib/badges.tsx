import { Award, BookOpen, Clock, Flame, FolderKanban, Footprints, Hourglass, Mountain, NotebookPen, Repeat, Rocket, Sprout, Target, Zap } from 'lucide-react'

/** Ikon per jenis (cadangan bila kode lencana belum dikenal). */
export const BADGE_ICON: Record<string, React.ReactNode> = {
  check: <Zap size={20} />, book: <BookOpen size={20} />, clock: <Clock size={20} />, target: <Target size={20} />,
  folder: <FolderKanban size={20} />, note: <NotebookPen size={20} />, flame: <Flame size={20} />, repeat: <Repeat size={20} />,
}

/** Ikon khusus per lencana agar tiap lencana mudah dibedakan (tanpa ikon ceklis). */
const BY_CODE: Record<string, React.ReactNode> = {
  tugas_1: <Footprints size={20} />, tugas_10: <Zap size={20} />, tugas_50: <Rocket size={20} />,
  modul_10: <BookOpen size={20} />, belajar_600: <Clock size={20} />, belajar_3000: <Hourglass size={20} />,
  target_1: <Target size={20} />, target_5: <Mountain size={20} />, proyek_1: <FolderKanban size={20} />,
  catatan_10: <NotebookPen size={20} />, streak_7: <Flame size={20} />, streak_30: <Sprout size={20} />, checkin_100: <Repeat size={20} />,
}

export function badgeIcon(code: string | undefined, icon: string): React.ReactNode {
  return (code && BY_CODE[code]) ?? BADGE_ICON[icon] ?? <Award size={20} />
}

/** Sama dengan warna modulnya: tugas/proyek biru laut, belajar oranye, target navy, catatan & streak kuning. */
export const BADGE_COLOR: Record<string, string> = {
  check: 'var(--c-blue)', folder: 'var(--c-blue)', book: 'var(--c-peach)', clock: 'var(--c-peach)',
  target: 'var(--c-lilac)', note: 'var(--c-rose)', flame: 'var(--c-rose)', repeat: 'var(--ok)',
}
