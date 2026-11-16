import { BookOpen, Check, Clock, FolderKanban, NotebookPen, Flame, Repeat, Target } from 'lucide-react'

/** Ikon lencana — dipakai di Pencapaian dan Beranda. */
export const BADGE_ICON: Record<string, React.ReactNode> = {
  check: <Check size={20} />, book: <BookOpen size={20} />, clock: <Clock size={20} />, target: <Target size={20} />,
  folder: <FolderKanban size={20} />, note: <NotebookPen size={20} />, flame: <Flame size={20} />, repeat: <Repeat size={20} />,
}
