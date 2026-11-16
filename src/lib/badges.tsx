import { BookOpen, Check, Clock, FolderKanban, NotebookPen, Flame, Repeat, Target } from 'lucide-react'

/** Ikon & warna lencana per kategori — dipakai di Pencapaian dan Beranda. */
export const BADGE_ICON: Record<string, React.ReactNode> = {
  check: <Check size={20} />, book: <BookOpen size={20} />, clock: <Clock size={20} />, target: <Target size={20} />,
  folder: <FolderKanban size={20} />, note: <NotebookPen size={20} />, flame: <Flame size={20} />, repeat: <Repeat size={20} />,
}
/** Sama dengan warna modulnya: tugas/proyek biru laut, belajar oranye, target navy, catatan & streak kuning. */
export const BADGE_COLOR: Record<string, string> = {
  check: 'var(--c-blue)', folder: 'var(--c-blue)', book: 'var(--c-peach)', clock: 'var(--c-peach)',
  target: 'var(--c-lilac)', note: 'var(--c-rose)', flame: 'var(--c-rose)', repeat: 'var(--ok)',
}
