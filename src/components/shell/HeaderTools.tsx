'use client'

import { AlertCircle, Award, Bell, BookOpen, CalendarClock, CheckSquare, Clock, CornerDownLeft, FolderKanban, History, NotebookPen, Repeat, Search, Target, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { globalSearch, loadNotifications, type Notif, type SearchHit, type SearchKind } from '@/app/(app)/header-actions'
import { tint } from '@/components/ui/display'

/* ------------------------------ util ------------------------------ */

/** Tutup saat klik di luar / Esc / pindah halaman. */
function usePopover(open: boolean, setOpen: (v: boolean) => void, root: React.RefObject<HTMLElement | null>) {
  const pathname = usePathname()
  const [at, setAt] = useState(pathname)
  if (at !== pathname) { setAt(pathname); if (open) setOpen(false) }
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen, root])
}

const KIND_ICON: Record<SearchKind, { icon: React.ReactNode; color: string }> = {
  tugas: { icon: <CheckSquare size={16} />, color: 'var(--c-blue)' },
  kegiatan: { icon: <CalendarClock size={16} />, color: 'var(--c-lilac)' },
  catatan: { icon: <NotebookPen size={16} />, color: 'var(--c-rose)' },
  target: { icon: <Target size={16} />, color: 'var(--c-lilac)' },
  proyek: { icon: <FolderKanban size={16} />, color: 'var(--c-blue)' },
  bidang: { icon: <BookOpen size={16} />, color: 'var(--c-peach)' },
  kebiasaan: { icon: <Repeat size={16} />, color: 'var(--c-peach)' },
}

/* ------------------------------ Pencarian ------------------------------ */

const RECENT_KEY = 'rp_recent_q'
function readRecent(): string[] {
  try { return typeof window === 'undefined' ? [] : (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).slice(0, 5) } catch { return [] }
}

/**
 * Kotak cari di header (desktop) / tombol kaca pembesar yang membuka lembar cari (ponsel).
 * Saat kosong: pencarian terakhir (bila ada).
 * Saat mengetik: hasil dari semua modul. Pintasan: Ctrl/⌘ + K.
 */
export function SearchBox() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [pending, start] = useTransition()
  const root = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const router = useRouter()
  const listId = useId()
  usePopover(open, setOpen, root)

  // Ctrl/⌘ + K → fokus ke kotak cari.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); requestAnimationFrame(() => input.current?.focus()) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Cari dengan jeda singkat agar tidak memanggil server di setiap ketukan.
  const term = q.trim()
  const searching = term.length >= 2
  useEffect(() => {
    if (term.length < 2) return
    const t = setTimeout(() => start(async () => { setHits(await globalSearch(term).catch(() => [])); setActive(0) }), 220)
    return () => clearTimeout(t)
  }, [term])

  function remember(text: string) {
    const next = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, 5)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* abaikan */ }
  }
  function clearRecent() {
    setRecent([])
    try { localStorage.removeItem(RECENT_KEY) } catch { /* abaikan */ }
  }
  function go(h: SearchHit) { remember(term); setOpen(false); setQ(''); router.push(h.href) }

  const shownHits = searching ? hits : []
  const shownRecent = searching ? [] : recent
  const rows: Array<() => void> = [
    ...shownRecent.map((r) => () => { setQ(r); input.current?.focus() }),
    ...shownHits.map((h) => () => go(h)),
  ]

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); rows[active < 0 ? 0 : active]?.() }
  }

  let idx = -1
  return (
    <div ref={root} className={`search-box${open ? ' is-open' : ''}`}>
      <button type="button" className="hdr-btn search-trigger" aria-label="Cari" onClick={() => { setOpen(true); requestAnimationFrame(() => input.current?.focus()) }}>
        <Search size={19} />
      </button>
      <div className="search-field">
        <Search size={16} className="search-field-icon" aria-hidden="true" />
        <input ref={input} type="search" className="search-input" placeholder="Cari tugas, catatan, target…" value={q} role="combobox"
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setActive(-1); setOpen(true) }} onKeyDown={onKeyDown} />
        {pending ? <span className="spinner search-kbd" aria-hidden="true" /> : <kbd className="search-kbd">Ctrl K</kbd>}
        <button type="button" className="search-close" aria-label="Tutup pencarian" onClick={() => { setOpen(false); setQ('') }}><X size={18} /></button>
      </div>

      {open && (searching || shownRecent.length > 0) && (
        <div id={listId} className="search-pop" role="listbox" aria-label="Pencarian">
          {shownRecent.length > 0 && (
            <div className="search-sec">
              <div className="search-group-row"><p className="search-group">Terakhir dicari</p><button type="button" className="search-clear" onClick={clearRecent}>Hapus</button></div>
              {shownRecent.map((r) => {
                idx++
                const i = idx
                return (
                  <button key={r} type="button" role="option" aria-selected={active === i} className={`search-row compact${active === i ? ' on' : ''}`}
                    onMouseEnter={() => setActive(i)} onClick={() => { setQ(r); input.current?.focus() }}>
                    <History size={15} className="search-muted" aria-hidden="true" />
                    <span className="search-title flex-1">{r}</span>
                  </button>
                )
              })}
            </div>
          )}

          {searching && (
            <div className="search-sec">
              <p className="search-group">Hasil</p>
              {shownHits.length === 0 ? (
                <p className="search-empty">{pending ? 'Mencari…' : `Tidak ada yang cocok dengan “${term}”.`}</p>
              ) : shownHits.map((h) => {
                idx++
                const i = idx
                const k = KIND_ICON[h.kind]
                return (
                  <Link key={`${h.kind}-${h.id}`} href={h.href} role="option" aria-selected={active === i} className={`search-row${active === i ? ' on' : ''}`}
                    onMouseEnter={() => setActive(i)} onClick={() => { remember(term); setOpen(false); setQ('') }}>
                    <span className="search-ico" style={tint(k.color)} aria-hidden="true">{k.icon}</span>
                    <span className="min-w-0 flex-1"><span className="search-title">{h.title}</span><span className="search-sub">{h.sub}</span></span>
                    {active === i && <CornerDownLeft size={14} className="search-muted" aria-hidden="true" />}
                  </Link>
                )
              })}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

/* ------------------------------ Notifikasi ------------------------------ */

const NOTIF_ICON: Record<Notif['kind'], { icon: React.ReactNode; color: string }> = {
  terlambat: { icon: <AlertCircle size={16} />, color: 'var(--err)' },
  'hari-ini': { icon: <Clock size={16} />, color: 'var(--c-blue)' },
  kegiatan: { icon: <CalendarClock size={16} />, color: 'var(--c-lilac)' },
  lencana: { icon: <Award size={16} />, color: 'var(--c-rose)' },
}
const SEEN_KEY = 'rp_notif_seen'

/** Lonceng: angka = tugas terlambat + tenggat & kegiatan hari ini; titik = lencana baru sejak dibuka terakhir. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ items: Notif[]; actionable: number } | null>(null)
  // Dibaca sekali saat dibuat; data notifikasi baru datang setelah hidrasi, jadi tidak ada beda server/klien.
  const [seen, setSeen] = useState<string>(() => { try { return typeof window === 'undefined' ? '' : localStorage.getItem(SEEN_KEY) ?? '' } catch { return '' } })
  const root = useRef<HTMLDivElement | null>(null)
  const pathname = usePathname()
  usePopover(open, setOpen, root)

  // Muat saat pertama tampil & setiap pindah halaman (data bisa berubah), tidak di setiap render.
  useEffect(() => { loadNotifications().then(setData).catch(() => {}) }, [pathname])

  const items = data?.items ?? []
  const freshBadge = items.some((i) => i.kind === 'lencana' && i.at > seen)
  const count = data?.actionable ?? 0

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      loadNotifications().then(setData).catch(() => {})
      const now = new Date().toISOString()
      try { localStorage.setItem(SEEN_KEY, now) } catch { /* abaikan */ }
      setSeen(now)
    }
  }

  const label = count ? `Notifikasi, ${count} perlu perhatian` : 'Notifikasi'
  return (
    <div ref={root} className="relative">
      <button type="button" className="hdr-btn" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Bell size={19} />
        {count > 0 ? <span className="hdr-count">{count > 9 ? '9+' : count}</span> : freshBadge ? <span className="hdr-dot" aria-hidden="true" /> : null}
      </button>
      {open && (
        <div className="menu notif-pop" role="dialog" aria-label="Notifikasi">
          <div className="notif-head">
            <span className="text-label">Notifikasi</span>
            {count > 0 && <span className="text-caption">{count} perlu perhatian</span>}
          </div>
          {data === null ? (
            <p className="search-empty">Memuat…</p>
          ) : items.length === 0 ? (
            <div className="notif-empty"><Bell size={20} aria-hidden="true" /><span>Semua beres. Tidak ada yang perlu dikejar hari ini.</span></div>
          ) : (
            <ul className="notif-list">
              {items.map((n) => {
                const k = NOTIF_ICON[n.kind]
                return (
                  <li key={n.key}>
                    <Link href={n.href} className="notif-row" onClick={() => setOpen(false)}>
                      <span className="search-ico" style={n.kind === 'terlambat' ? { color: 'var(--err)', background: 'var(--err-soft)' } : tint(k.color)} aria-hidden="true">{k.icon}</span>
                      <span className="min-w-0 flex-1"><span className="search-title">{n.title}</span><span className={`search-sub${n.kind === 'terlambat' ? ' overdue' : ''}`}>{n.sub}</span></span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="notif-foot"><Link href="/tugas?tab=hari-ini" className="link-sm" onClick={() => setOpen(false)}>Lihat tugas hari ini</Link></div>
        </div>
      )}
    </div>
  )
}
