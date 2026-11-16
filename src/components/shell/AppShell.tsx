'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, LayoutGrid, LogOut, Menu, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { signOut } from '@/app/auth-actions'
import { AppLogo, APP_NAME, APP_TAGLINE } from './AppLogo'
import { QuickAddMenu, QuickAddProvider } from './QuickAdd'
import { ALL_ITEMS, BOTTOM_ITEMS, NAV_GROUPS, isActivePath } from './nav'

interface ShellUser { name: string; email: string }

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname()
  // Menu terbuka "untuk" path tertentu → otomatis tertutup saat pindah halaman (tanpa setState di efek).
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => setOpenAt((typeof v === 'function' ? v(open) : v) ? pathname : null)
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <QuickAddProvider>
    <div className="shell has-bnav">
      <a href="#konten" className="skip-link">Lewati ke konten</a>
      <Sidebar open={open} onClose={() => setOpen(false)} pathname={pathname} />
      <div className="shell-main">
        <TopBar user={user} onToggle={() => setOpen((v) => !v)} />
        <div className="shell-scroll">
          <main id="konten" className="shell-content" tabIndex={-1}>{children}</main>
          <footer className="footer">
            <p className="footer-copy">&copy; {new Date().getFullYear()} {APP_NAME}. Seluruh hak cipta dilindungi.</p>
            <p className="footer-meta">Satu ruang untuk mencatat, merencanakan, dan mencapai.</p>
          </footer>
        </div>
        <MobileBottomNav pathname={pathname} />
      </div>
    </div>
    </QuickAddProvider>
  )
}

function Sidebar({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  return (
    <>
      {open && <div className="sidebar-overlay" aria-hidden="true" onClick={onClose} />}
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Navigasi">
        <div className="sidebar-brand">
          <AppLogo size={34} />
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{APP_TAGLINE}</small>
          </span>
          <button className="sidebar-close" type="button" aria-label="Tutup menu" onClick={onClose}><X size={18} /></button>
        </div>
        <nav className="sidebar-nav">
          {NAV_GROUPS.map((g, gi) => (
            <div key={g.title}>
              <p className={`nav-label${gi ? ' nav-label-gap' : ''}`}>{g.title}</p>
              <ul className="nav-group">
                {g.items.map((item) => {
                  const active = isActivePath(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link href={item.href} prefetch className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                        <Icon size={17} strokeWidth={1.9} /><span>{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <form action={signOut}>
            <button className="nav-item nav-item-danger" type="submit"><LogOut size={17} strokeWidth={1.9} /><span>Keluar</span></button>
          </form>
        </div>
      </aside>
    </>
  )
}

function TopBar({ user, onToggle }: { user: ShellUser; onToggle: () => void }) {
  const initial = (user.name.trim()[0] ?? '?').toUpperCase()
  return (
    <header className="topbar">
      <button className="topbar-burger" type="button" aria-label="Buka menu" onClick={onToggle}><Menu size={20} /></button>
      <AppLogo size={32} className="topbar-logo" />
      <div className="topbar-actions">
        <QuickAddMenu />
      </div>
      <div className="topbar-user">
        <span className="avatar" aria-hidden="true">{initial}</span>
        <span className="user-meta">
          <span className="user-name">{user.name}</span>
          <span className="user-role">{user.email || 'Pengguna pribadi'}</span>
        </span>
      </div>
    </header>
  )
}

// Punuk landai: tepi atas bar (y=36) naik halus melingkari lingkaran 54px (pusat 45,32) berjarak 7px.
const HUMP = 'M0 36 L1 36 C6 36 10.65 30.92 11.53 26 A34 34 0 0 1 78.47 26 C79.35 30.92 84 36 89 36 L90 36'

/** Menu bawah ponsel (< 768px): kapsul mengambang + punuk yang bergeser ke menu aktif, dan lembar "Lainnya". */
function MobileBottomNav({ pathname }: { pathname: string }) {
  const items = BOTTOM_ITEMS.map((h) => ALL_ITEMS.find((i) => i.href === h)!)
  const moreItems = ALL_ITEMS.filter((i) => !BOTTOM_ITEMS.includes(i.href))
  const slots = items.length + 1
  const directIdx = items.findIndex((i) => isActivePath(pathname, i.href))
  const moreActive = directIdx < 0 && moreItems.some((m) => isActivePath(pathname, m.href))
  const active = directIdx >= 0 ? directIdx : moreActive ? items.length : -1
  const BubbleIcon = active < 0 ? null : active === items.length
    ? (moreItems.find((m) => isActivePath(pathname, m.href))?.icon ?? LayoutGrid)
    : items[active]!.icon
  const bubbleKey = active === items.length ? pathname : String(active)

  const [sheetAt, setSheetAt] = useState<string | null>(null)
  const sheetOpen = sheetAt === pathname
  const setSheetOpen = (v: boolean) => setSheetAt(v ? pathname : null)
  const moreBtn = useRef<HTMLButtonElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    if (!sheetOpen) return
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => sheet.current?.querySelector<HTMLElement>('a, button')?.focus())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSheetAt(null); moreBtn.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [sheetOpen])

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !BOTTOM_ITEMS.includes(i.href)) })).filter((g) => g.items.length)

  return (
    <>
      <nav className="bnav" aria-label="Menu utama" data-testid="bottom-nav"
        style={{ '--i': Math.max(active, 0), '--n': slots } as React.CSSProperties}>
        {BubbleIcon && (
          <span className="bnav-bubble" aria-hidden="true">
            <svg className="bnav-hump" width="90" height="40" viewBox="0 0 90 40"><path d={`${HUMP} L90 40 L0 40 Z`} className="hump-fill" /></svg>
            <span className="bnav-circle"><BubbleIcon key={bubbleKey} size={23} strokeWidth={2} /></span>
          </span>
        )}
        {items.map((it, i) => {
          const Icon = it.icon
          return (
            <Link key={it.href} href={it.href} prefetch className={`bnav-item${i === active ? ' active' : ''}`} aria-current={i === active ? 'page' : undefined}>
              <span className="bnav-icon"><Icon size={21} strokeWidth={1.9} aria-hidden="true" /></span>
              <span className="bnav-label">{it.short ?? it.label}</span>
            </Link>
          )
        })}
        <button ref={moreBtn} className={`bnav-item${active === items.length ? ' active' : ''}`} type="button" aria-haspopup="dialog"
          aria-expanded={sheetOpen} aria-current={active === items.length ? 'page' : undefined} onClick={() => setSheetOpen(true)}>
          <span className="bnav-icon"><LayoutGrid size={21} strokeWidth={1.9} aria-hidden="true" /></span>
          <span className="bnav-label">Lainnya</span>
        </button>
      </nav>

      {sheetOpen && (
        <div className="sheet-root" onClick={(e) => { if (e.target === e.currentTarget) setSheetOpen(false) }}>
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <span className="sheet-handle" aria-hidden="true" />
            <div className="sheet-head">
              <div>
                <h2 id={titleId} className="sheet-title">Menu lainnya</h2>
                <p className="text-caption">Kalender, catatan, pencapaian & akun</p>
              </div>
              <button className="sheet-close" type="button" aria-label="Tutup menu lainnya" onClick={() => setSheetOpen(false)}><X size={18} /></button>
            </div>
            <div className="sheet-body">
              {groups.map((g) => (
                <section key={g.title} className="sheet-group" aria-label={g.title}>
                  <p className="sheet-group-title">{g.title}</p>
                  <ul className="sheet-list">
                    {g.items.map((m) => {
                      const on = isActivePath(pathname, m.href)
                      const Icon = m.icon
                      return (
                        <li key={m.href}>
                          <Link href={m.href} prefetch className={`sheet-item${on ? ' current' : ''}`} aria-current={on ? 'page' : undefined}>
                            <span className="sheet-icon" aria-hidden="true"><Icon size={18} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="sheet-label">{m.label}{on && <span className="badge sheet-now">Sedang dibuka</span>}</span>
                              <span className="sheet-desc">{m.desc}</span>
                            </span>
                            <ChevronRight size={16} className="sheet-chev" aria-hidden="true" />
                          </Link>
                        </li>
                      )
                    })}
                    {g.title === 'Akun' && (
                      <li>
                        <form action={signOut}>
                          <button className="sheet-item sheet-logout" type="submit">
                            <span className="sheet-icon" aria-hidden="true"><LogOut size={18} /></span>
                            <span className="min-w-0 flex-1"><span className="sheet-label">Keluar</span><span className="sheet-desc">Akhiri sesi di perangkat ini</span></span>
                          </button>
                        </form>
                      </li>
                    )}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
