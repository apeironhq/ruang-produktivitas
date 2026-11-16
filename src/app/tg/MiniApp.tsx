'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, BarChart3, Bell, BellRing, BookOpen, CalendarDays, Check, ChevronRight, Clock, ExternalLink, GraduationCap,
  ListChecks, MapPin, Minus, NotebookPen, Sparkles, SquareCheckBig, SquarePen, Target, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react'
import { tgAddNote, tgAddSession, tgAddTask, tgHome, tgToggleTask, tgView } from './actions'
import type { MiniHome, MiniItem, MiniResult, MiniView, MiniViewName } from './types'

/* ---------- API Telegram WebApp (bagian yang dipakai) ---------- */
interface TgWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  setHeaderColor(c: string): void
  setBackgroundColor(c: string): void
  openLink(url: string): void
  onEvent(e: string, cb: () => void): void
  offEvent(e: string, cb: () => void): void
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium'): void; notificationOccurred(t: 'success' | 'error'): void; selectionChanged(): void }
}
declare global { interface Window { Telegram?: { WebApp: TgWebApp } } }

type Sheet = null | 'catat' | 'catatan' | 'tugas' | 'sesi'
type Phase = 'loading' | 'outside' | 'tidak-valid' | 'belum-tertaut' | 'error' | 'ready'

const MENU: Array<{ key: MiniViewName | 'catat'; title: string; desc: string; color: string; icon: React.ReactNode }> = [
  { key: 'catat', title: 'Catat Aktivitas', desc: 'Tugas, belajar, atau catatan', color: 'var(--ma-blue)', icon: <SquarePen size={20} /> },
  { key: 'tugas', title: 'Tugas Saya', desc: 'Lihat dan kelola tugas', color: 'var(--ma-sky)', icon: <ListChecks size={20} /> },
  { key: 'belajar', title: 'Jurnal Belajar', desc: 'Catat materi & progres', color: 'var(--ma-lilac)', icon: <BookOpen size={20} /> },
  { key: 'target', title: 'Target Saya', desc: 'Pantau semua target', color: 'var(--ma-rose)', icon: <Target size={20} /> },
  { key: 'uang', title: 'Keuangan', desc: 'Pemasukan & pengeluaran', color: 'var(--ma-peach)', icon: <Wallet size={20} /> },
  { key: 'ringkasan', title: 'Ringkasan', desc: 'Laporan & perkembangan', color: 'var(--ma-green)', icon: <BarChart3 size={20} /> },
]
const VIEW_META: Record<MiniViewName, { title: string; desc: string; color: string; icon: React.ReactNode }> = {
  tugas: { title: 'Tugas Saya', desc: 'Tugas & kegiatan yang belum selesai', color: 'var(--ma-sky)', icon: <ListChecks size={22} /> },
  belajar: { title: 'Jurnal Belajar', desc: '7 hari terakhir', color: 'var(--ma-lilac)', icon: <BookOpen size={22} /> },
  target: { title: 'Target Saya', desc: 'Target yang sedang berjalan', color: 'var(--ma-rose)', icon: <Target size={22} /> },
  uang: { title: 'Keuangan', desc: 'Bulan ini', color: 'var(--ma-peach)', icon: <Wallet size={22} /> },
  ringkasan: { title: 'Ringkasan', desc: '7 hari terakhir dibanding 7 hari sebelumnya', color: 'var(--ma-green)', icon: <BarChart3 size={22} /> },
  notif: { title: 'Notifikasi', desc: 'Pengingat 24 jam ke depan & riwayat', color: 'var(--ma-blue)', icon: <Bell size={22} /> },
}
const WEB_PATH: Record<MiniViewName, string> = { tugas: '/tugas', belajar: '/belajar', target: '/target', uang: '/keuangan', ringkasan: '/pencapaian', notif: '/pengaturan' }

export function MiniApp() {
  const tgRef = useRef<TgWebApp | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [scheme, setScheme] = useState<'dark' | 'light'>('dark')
  const [home, setHome] = useState<MiniHome | null>(null)
  const [view, setView] = useState<MiniViewName | 'home'>('home')
  const [viewData, setViewData] = useState<MiniView | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewReq = useRef(0)

  const initData = () => tgRef.current?.initData ?? ''
  const haptic = (k: 'tap' | 'ok' | 'err') => {
    const h = tgRef.current?.HapticFeedback
    try { if (k === 'tap') h?.impactOccurred('light'); else h?.notificationOccurred(k === 'ok' ? 'success' : 'error') } catch { /* versi lama */ }
  }
  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const loadHome = useCallback(async () => {
    try {
      const res = await tgHome(initData())
      if (!res.ok) { setPhase(res.reason); return }
      setHome(res.home)
      setChecked({})
      setPhase('ready')
    } catch {
      setPhase((p) => (p === 'ready' ? p : 'error'))
    }
  }, [])

  const loadView = useCallback(async (name: MiniViewName) => {
    const id = ++viewReq.current
    try {
      const data = await tgView(initData(), name)
      if (id === viewReq.current) setViewData(data)
    } catch {
      if (id === viewReq.current) showToast('Gagal memuat. Periksa koneksi.', true)
    }
  }, [showToast])

  function init() {
    const w = window.Telegram?.WebApp
    if (!w || !w.initData) { setPhase('outside'); return }
    tgRef.current = w
    w.ready()
    w.expand()
    const apply = () => {
      const s = w.colorScheme === 'light' ? 'light' : 'dark'
      setScheme(s)
      const bg = s === 'light' ? '#eef3fb' : '#0d1729'
      try { w.setHeaderColor(bg); w.setBackgroundColor(bg) } catch { /* versi lama */ }
    }
    apply()
    w.onEvent('themeChanged', apply)
    void loadHome()
  }

  function openView(name: MiniViewName) {
    haptic('tap')
    setView(name)
    setViewData(null)
    window.scrollTo({ top: 0 })
    void loadView(name)
  }
  const goHome = useCallback(() => { setView('home'); setViewData(null); window.scrollTo({ top: 0 }) }, [])

  // Tombol Kembali bawaan Telegram: tutup lembar dulu, lalu kembali ke beranda.
  useEffect(() => {
    const w = tgRef.current
    if (!w) return
    const back = () => { if (sheet) setSheet(null); else goHome() }
    if (sheet || view !== 'home') { w.BackButton.show(); w.BackButton.onClick(back) } else w.BackButton.hide()
    return () => w.BackButton.offClick(back)
  }, [sheet, view, goHome, phase])

  async function afterAction(res: MiniResult) {
    if (!res.ok) { haptic('err'); showToast(res.message, true); return false }
    haptic('ok')
    showToast(res.message)
    void loadHome()
    if (view !== 'home') void loadView(view)
    return true
  }

  async function toggle(item: MiniItem) {
    const next = !(checked[item.id] ?? false)
    haptic('tap')
    setChecked((c) => ({ ...c, [item.id]: next }))
    const res = await tgToggleTask(initData(), item.id, next).catch(() => ({ ok: false, message: 'Koneksi bermasalah.' }) as MiniResult)
    if (!res.ok) setChecked((c) => ({ ...c, [item.id]: !next }))
    await afterAction(res)
  }

  function openWeb(path = '/') {
    const base = home?.siteUrl
    if (!base) return
    try { tgRef.current?.openLink(`${base}${path}`) } catch { window.open(`${base}${path}`, '_blank') }
  }

  const script = <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={init} />

  if (phase !== 'ready' || !home) {
    return (
      <div className="ma" data-scheme={scheme}>
        {script}
        {phase === 'loading' ? <Skeleton /> : (
          <div className="ma-center">
            <span className="ma-tile-icon" style={{ background: 'var(--ma-blue)', width: 54, height: 54, borderRadius: 16 }}><Sparkles size={26} /></span>
            <h1>{phase === 'belum-tertaut' ? 'Akun belum ditautkan' : phase === 'outside' ? 'Buka Rupi dari Telegram' : 'Tidak bisa memuat Rupi'}</h1>
            <p>
              {phase === 'belum-tertaut' && 'Buka Pengaturan → Bot Telegram di Ruang Produktivitas, tekan "Buat kode tautan", lalu kirim kodenya ke bot.'}
              {phase === 'outside' && 'Halaman ini adalah Mini App. Buka chat bot Rupi di Telegram lalu tekan tombol Menu.'}
              {phase === 'tidak-valid' && 'Sesi Telegram tidak valid atau kedaluwarsa. Tutup lalu buka lagi Rupi.'}
              {phase === 'error' && 'Periksa koneksi internet, lalu coba lagi.'}
            </p>
            {phase === 'error' && <button className="ma-btn-ghost" onClick={() => { setPhase('loading'); void loadHome() }}>Coba lagi</button>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ma" data-scheme={scheme}>
      {script}
      <div className="ma-wrap">
        {view === 'home' ? (
          <Home home={home} checked={checked} onToggle={toggle} onMenu={(k) => (k === 'catat' ? (haptic('tap'), setSheet('catat')) : openView(k))}
            onNotif={() => openView('notif')} onOpenWeb={() => openWeb('/')} />
        ) : (
          <SubView name={view} data={viewData} checked={checked} onToggle={toggle} onOpenWeb={() => openWeb(WEB_PATH[view])} canOpenWeb={!!home.siteUrl} />
        )}
      </div>

      {sheet && (
        <SheetFrame onClose={() => setSheet(null)} title={sheet === 'catat' ? 'Catat aktivitas' : sheet === 'catatan' ? 'Catatan baru' : sheet === 'tugas' ? 'Tugas baru' : 'Sesi belajar'}
          icon={sheet === 'catatan' ? <NotebookPen size={18} /> : sheet === 'tugas' ? <SquareCheckBig size={18} /> : sheet === 'sesi' ? <GraduationCap size={18} /> : <SquarePen size={18} />}>
          {sheet === 'catat' && (
            <div>
              <Choice icon={<NotebookPen size={20} />} color="var(--ma-rose)" title="Catatan" desc="Ide, ringkasan, atau jurnal cepat" onClick={() => setSheet('catatan')} />
              <Choice icon={<SquareCheckBig size={20} />} color="var(--ma-blue)" title="Tugas baru" desc="Dengan tenggat & pengingat" onClick={() => setSheet('tugas')} />
              <Choice icon={<GraduationCap size={20} />} color="var(--ma-lilac)" title="Sesi belajar" desc="Bidang, durasi, dan materi" onClick={() => setSheet('sesi')} />
            </div>
          )}
          {sheet === 'catatan' && <NoteForm onSubmit={async (t, c) => { if (await afterAction(await tgAddNote(initData(), t, c))) setSheet(null) }} />}
          {sheet === 'tugas' && <TaskForm today={home.today} onSubmit={async (t, d, r) => { if (await afterAction(await tgAddTask(initData(), t, d, r))) setSheet(null) }} />}
          {sheet === 'sesi' && <SessionForm subjects={home.subjects} onSubmit={async (s, m, mat) => { if (await afterAction(await tgAddSession(initData(), s, m, mat))) setSheet(null) }} />}
        </SheetFrame>
      )}

      {toast && <div className={`ma-toast${toast.err ? ' err' : ''}`} role="status">{toast.msg}</div>}
    </div>
  )
}

/* ---------- Beranda ---------- */
function Home({ home, checked, onToggle, onMenu, onNotif, onOpenWeb }: {
  home: MiniHome; checked: Record<string, boolean>; onToggle: (i: MiniItem) => void; onMenu: (k: MiniViewName | 'catat') => void; onNotif: () => void; onOpenWeb: () => void
}) {
  return (
    <>
      <div className="ma-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tg/header.jpg" alt="Rupi — Ruang Produktivitas, asisten produktivitas pribadimu" />
        <button className="ma-bell" onClick={onNotif} aria-label={`Notifikasi${home.notifCount ? `, ${home.notifCount} pengingat` : ''}`}>
          <Bell size={19} />
          {home.notifCount > 0 && <span className="ma-bell-dot">{home.notifCount > 9 ? '9+' : home.notifCount}</span>}
        </button>
      </div>

      <div className="ma-hello">
        <h1>{home.greeting}, {home.name}! 👋</h1>
        <p>Berikut ringkasan aktivitas dan perkembanganmu hari ini.</p>
      </div>

      <div className="ma-kpis">
        <Kpi icon={<SquareCheckBig size={20} />} color="var(--ma-blue)" label="Tugas Aktif" value={String(home.stats.tasks)} />
        <Kpi icon={<BookOpen size={20} />} color="var(--ma-lilac)" label="Belajar Hari Ini" value={`${home.stats.sessions} sesi`} sub={home.stats.sessionMinutes} />
        <Kpi icon={<Wallet size={20} />} color="var(--ma-green)" label="Pengeluaran" value={home.stats.expense} />
        <Kpi icon={<Target size={20} />} color="var(--ma-peach)" label="Target Aktif" value={String(home.stats.goals)} />
      </div>

      <section className="ma-card">
        <div className="ma-card-head">
          <h2><CalendarDays size={18} />Agenda Hari Ini</h2>
          <span className="ma-pill"><CalendarDays size={13} />{home.dateLabel}</span>
        </div>
        {home.agenda.length === 0 ? <div className="ma-empty">Tidak ada tugas atau kegiatan hari ini. 🎉</div>
          : home.agenda.map((it) => <ItemRow key={it.id} it={it} checked={checked} onToggle={onToggle} />)}
        {home.more > 0 && <button className="ma-more" onClick={() => onMenu('tugas')}>+{home.more} lainnya — lihat semua tugas</button>}
      </section>

      <div className="ma-section-title"><Sparkles size={18} color="#f5c542" />Apa yang ingin kamu lakukan sekarang?</div>
      <div className="ma-menu">
        {MENU.map((m) => (
          <button key={m.key} className="ma-tile" onClick={() => onMenu(m.key)}>
            <span className="ma-tile-icon" style={{ background: m.color }}>{m.icon}</span>
            <span className="min-w-0">
              <span className="ma-tile-title">{m.title}</span>
              <span className="ma-tile-desc">{m.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {home.siteUrl && (
        <button className="ma-open" onClick={onOpenWeb}>
          <ExternalLink size={19} />Buka Ruang Produktivitas<ArrowUpRight size={19} className="ma-open-arrow" />
        </button>
      )}
    </>
  )
}

function Kpi({ icon, color, label, value, sub }: { icon: React.ReactNode; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className="ma-kpi">
      <span className="ma-kpi-icon" style={{ background: color }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span className="ma-kpi-label">{label}</span>
        <span className="ma-kpi-value">{value}{sub && <span className="ma-kpi-sub">{sub}</span>}</span>
      </span>
    </div>
  )
}

function ItemRow({ it, checked, onToggle }: { it: MiniItem; checked: Record<string, boolean>; onToggle: (i: MiniItem) => void }) {
  const on = checked[it.id] ?? false
  return (
    <div className={`ma-row${on ? ' done' : ''}`}>
      {it.kind === 'tugas'
        ? <button className={`ma-check${on ? ' on' : ''}`} onClick={() => onToggle(it)} aria-pressed={on} aria-label={on ? `Buka lagi: ${it.title}` : `Tandai selesai: ${it.title}`}>{on && <Check size={14} strokeWidth={3} />}</button>
        : <Clock size={20} className="ma-ev" aria-label="Kegiatan" />}
      <span className="ma-row-main">
        <span className="ma-row-title">{it.title}</span>
        {it.sub && <span className="ma-row-sub">{it.kind === 'kegiatan' && <MapPin size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: '-1px' }} />}{it.sub}</span>}
      </span>
      {it.late && !on && <span className="ma-late">Terlambat</span>}
      {it.time && <span className={`ma-row-right${it.late && !on ? ' late' : ''}`}>{it.time}</span>}
    </div>
  )
}

/* ---------- Sub-halaman ---------- */
function SubView({ name, data, checked, onToggle, onOpenWeb, canOpenWeb }: {
  name: MiniViewName; data: MiniView | null; checked: Record<string, boolean>; onToggle: (i: MiniItem) => void; onOpenWeb: () => void; canOpenWeb: boolean
}) {
  const meta = VIEW_META[name]
  return (
    <>
      <div className="ma-sub-head">
        <span className="ma-tile-icon" style={{ background: meta.color }}>{meta.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>{meta.title}</h1>
          <p>{data?.view === 'uang' ? data.month : meta.desc}</p>
        </div>
      </div>
      {!data ? <><div className="ma-skel" style={{ height: 90 }} /><div className="ma-skel" style={{ height: 220 }} /></> : <ViewBody data={data} checked={checked} onToggle={onToggle} />}
      {canOpenWeb && <button className="ma-btn-ghost" onClick={onOpenWeb}><ExternalLink size={15} />Kelola di aplikasi web</button>}
    </>
  )
}

function ViewBody({ data, checked, onToggle }: { data: MiniView; checked: Record<string, boolean>; onToggle: (i: MiniItem) => void }) {
  switch (data.view) {
    case 'tugas':
      if (!data.groups.length) return <section className="ma-card"><div className="ma-empty">Semua tugas beres. Mantap! 🎉</div></section>
      return <>{data.groups.map((g) => (
        <div key={g.title} style={{ display: 'contents' }}>
          <div className={`ma-group-title${g.tone === 'late' ? ' late' : ''}`}>{g.title} · {g.items.length}</div>
          <section className="ma-card">{g.items.map((it) => <ItemRow key={it.id} it={it} checked={checked} onToggle={onToggle} />)}</section>
        </div>
      ))}</>
    case 'belajar':
      return (
        <>
          <div className="ma-stat-grid">
            <div className="ma-stat"><span>Total waktu belajar</span><strong>{data.total}</strong></div>
            <div className="ma-stat"><span>Jumlah sesi</span><strong>{data.count} sesi</strong></div>
          </div>
          <div className="ma-group-title">Bidang aktif</div>
          <section className="ma-card">
            {data.subjects.length === 0 ? <div className="ma-empty">Belum ada bidang belajar aktif.</div> : data.subjects.map((s) => (
              <div key={s.id} className="ma-row" style={{ display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="ma-row-title">{s.title}</span><span className="ma-row-right">{s.minutes}</span></div>
                <div className="ma-bar"><span style={{ width: `${s.pct}%`, background: 'var(--ma-lilac)' }} /></div>
              </div>
            ))}
          </section>
          <div className="ma-group-title">Sesi terakhir</div>
          <ListCard rows={data.recent} empty="Belum ada sesi belajar." />
        </>
      )
    case 'target':
      return (
        <section className="ma-card">
          {data.goals.length === 0 ? <div className="ma-empty">Belum ada target aktif.</div> : data.goals.map((g) => (
            <div key={g.id} className="ma-row" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="ma-row-title">{g.title}</span><span className="ma-row-right" style={{ color: 'var(--ma-text)' }}>{g.percent}%</span></div>
              <div className="ma-bar"><span style={{ width: `${g.percent}%`, background: 'var(--ma-rose)' }} /></div>
              <span className="ma-row-sub" style={{ marginTop: 6 }}>{g.sub}{g.due ? ` · ${g.due}` : ''}</span>
            </div>
          ))}
        </section>
      )
    case 'uang':
      return (
        <>
          <div className="ma-stat-grid">
            <div className="ma-stat"><span>Pemasukan</span><strong style={{ color: 'var(--ma-green)' }}>{data.income}</strong></div>
            <div className="ma-stat"><span>Pengeluaran</span><strong>{data.expense}</strong></div>
            <div className="ma-stat"><span>{data.diffNeg ? 'Defisit' : 'Sisa'}</span><strong style={{ color: data.diffNeg ? 'var(--ma-late)' : undefined }}>{data.diff}</strong></div>
            <div className="ma-stat"><span>Pengeluaran hari ini</span><strong>{data.today}</strong></div>
          </div>
          {data.top.length > 0 && <>
            <div className="ma-group-title">Pengeluaran terbesar</div>
            <section className="ma-card">{data.top.map((t) => (
              <div key={t.name} className="ma-row" style={{ display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="ma-row-title">{t.name}</span><span className="ma-row-right">{t.amount}</span></div>
                <div className="ma-bar"><span style={{ width: `${t.pct}%`, background: 'var(--ma-peach)' }} /></div>
              </div>
            ))}</section>
          </>}
          <div className="ma-group-title">Transaksi terakhir</div>
          <section className="ma-card">
            {data.recent.length === 0 ? <div className="ma-empty">Belum ada transaksi.</div> : data.recent.map((t, i) => (
              <div key={i} className="ma-row">
                <span className="ma-row-main"><span className="ma-row-title">{t.title}</span><span className="ma-row-sub">{t.sub}</span></span>
                <span className="ma-row-right" style={{ color: t.income ? 'var(--ma-green)' : 'var(--ma-text)' }}>{t.amount}</span>
              </div>
            ))}
          </section>
        </>
      )
    case 'ringkasan':
      return (
        <section className="ma-card">
          {data.rows.map((r) => (
            <div key={r.label} className="ma-row">
              <span className="ma-row-main"><span className="ma-row-title">{r.label}</span><span className="ma-row-sub">Sebelumnya {r.prev}</span></span>
              <span style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', fontSize: 17, fontWeight: 500 }}>{r.cur}</span>
                <span className={`ma-trend ${r.trend}`}>{r.trend === 'up' ? <TrendingUp size={13} /> : r.trend === 'down' ? <TrendingDown size={13} /> : <Minus size={13} />}{r.trend === 'up' ? 'naik' : r.trend === 'down' ? 'turun' : 'sama'}</span>
              </span>
            </div>
          ))}
        </section>
      )
    case 'notif':
      return (
        <>
          <div className="ma-group-title">Akan datang</div>
          <section className="ma-card">
            {data.upcoming.length === 0 ? <div className="ma-empty">Tidak ada pengingat dalam 24 jam ke depan. Atur lewat kolom “Ingatkan” saat menambah tugas.</div> : data.upcoming.map((n, i) => (
              <div key={i} className="ma-row">
                <BellRing size={18} style={{ color: 'var(--ma-blue)', flexShrink: 0 }} />
                <span className="ma-row-main"><span className="ma-row-title">{n.title}</span><span className="ma-row-sub">{n.sub}</span></span>
                <span className="ma-row-right">{n.right}</span>
              </div>
            ))}
          </section>
          <div className="ma-group-title">Riwayat</div>
          <section className="ma-card">
            {data.recent.length === 0 ? <div className="ma-empty">Belum ada notifikasi terkirim.</div> : data.recent.map((n, i) => (
              <div key={i} className="ma-row">
                <span className="ma-dot" style={{ background: n.status === 'terkirim' ? 'var(--ma-green)' : n.status === 'gagal' ? 'var(--ma-late)' : 'var(--ma-faint)' }} />
                <span className="ma-row-main"><span className="ma-row-title">{n.title}</span><span className="ma-row-sub">{n.sub}</span></span>
                <span className="ma-row-right">{n.status === 'terkirim' ? 'Terkirim' : n.status === 'gagal' ? 'Gagal' : 'Dilewati'}</span>
              </div>
            ))}
          </section>
        </>
      )
  }
}

function ListCard({ rows, empty }: { rows: Array<{ title: string; sub: string; right: string }>; empty: string }) {
  return (
    <section className="ma-card">
      {rows.length === 0 ? <div className="ma-empty">{empty}</div> : rows.map((r, i) => (
        <div key={i} className="ma-row">
          <span className="ma-row-main"><span className="ma-row-title">{r.title}</span><span className="ma-row-sub">{r.sub}</span></span>
          <span className="ma-row-right">{r.right}</span>
        </div>
      ))}
    </section>
  )
}

/* ---------- Lembar & form ---------- */
function SheetFrame({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ma-sheet-backdrop" onClick={onClose}>
      <div className="ma-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ma-sheet-grip" />
        <div className="ma-sheet-head">
          <h3>{icon}{title}</h3>
          <button className="ma-x" onClick={onClose} aria-label="Tutup"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Choice({ icon, color, title, desc, onClick }: { icon: React.ReactNode; color: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button className="ma-choice" onClick={onClick}>
      <span className="ma-tile-icon" style={{ background: color }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}><span className="ma-tile-title">{title}</span><span className="ma-tile-desc">{desc}</span></span>
      <ChevronRight size={18} style={{ color: 'var(--ma-muted)' }} />
    </button>
  )
}

function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return <button type="submit" className="ma-submit" disabled={busy}>{busy ? <span className="ma-spin" style={{ width: 20, height: 20, borderWidth: 2, borderTopColor: '#fff' }} /> : children}</button>
}

function useBusy() {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn() } finally { setBusy(false) } }
  return { busy, run }
}

function NoteForm({ onSubmit }: { onSubmit: (title: string, content: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const { busy, run } = useBusy()
  return (
    <form className="ma-form" onSubmit={(e) => { e.preventDefault(); void run(() => onSubmit(title, content)) }}>
      <div className="ma-field"><label htmlFor="n-t">Judul</label><input id="n-t" className="ma-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Mis. Ide fitur ekspor PDF" /></div>
      <div className="ma-field"><label htmlFor="n-c">Isi catatan</label><textarea id="n-c" className="ma-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Tulis di sini…" /></div>
      <Submit busy={busy}><Check size={18} />Simpan catatan</Submit>
    </form>
  )
}

const REMIND = [{ v: '', l: 'Tanpa' }, { v: '0', l: 'Tepat waktu' }, { v: '30', l: '30 menit' }, { v: '60', l: '1 jam' }, { v: '1440', l: '1 hari' }]

function TaskForm({ today, onSubmit }: { today: string; onSubmit: (title: string, due: string, remind: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [remind, setRemind] = useState('')
  const { busy, run } = useBusy()
  const tomorrow = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
  const quick = [{ l: 'Hari ini 17.00', v: `${today}T17:00` }, { l: 'Besok 09.00', v: `${tomorrow}T09:00` }, { l: 'Tanpa tenggat', v: '' }]
  return (
    <form className="ma-form" onSubmit={(e) => { e.preventDefault(); void run(() => onSubmit(title, due, remind)) }}>
      <div className="ma-field"><label htmlFor="t-t">Judul tugas</label><input id="t-t" className="ma-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Mis. Kirim laporan mingguan" required /></div>
      <div className="ma-field">
        <label htmlFor="t-d">Tenggat</label>
        <div className="ma-chips" style={{ marginBottom: 8 }}>
          {quick.map((q) => <button type="button" key={q.l} className={`ma-chip${due === q.v ? ' on' : ''}`} onClick={() => { setDue(q.v); if (!q.v) setRemind('') }}>{q.l}</button>)}
        </div>
        <input id="t-d" type="datetime-local" className="ma-input" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {due && (
        <div className="ma-field">
          <label>Ingatkan</label>
          <div className="ma-chips">{REMIND.map((r) => <button type="button" key={r.v} className={`ma-chip${remind === r.v ? ' on' : ''}`} onClick={() => setRemind(r.v)}>{r.l}</button>)}</div>
        </div>
      )}
      <Submit busy={busy}><Check size={18} />Tambah tugas</Submit>
    </form>
  )
}

function SessionForm({ subjects, onSubmit }: { subjects: Array<{ id: string; title: string }>; onSubmit: (subjectId: string, minutes: number, material: string) => Promise<void> }) {
  const [subject, setSubject] = useState(subjects[0]?.id ?? '')
  const [minutes, setMinutes] = useState('45')
  const [material, setMaterial] = useState('')
  const { busy, run } = useBusy()
  if (!subjects.length) return <div className="ma-empty">Belum ada bidang belajar aktif. Tambahkan bidang di Ruang Belajar dulu.</div>
  return (
    <form className="ma-form" onSubmit={(e) => { e.preventDefault(); void run(() => onSubmit(subject, Number(minutes), material)) }}>
      <div className="ma-field"><label>Bidang</label><div className="ma-chips">{subjects.map((s) => <button type="button" key={s.id} className={`ma-chip${subject === s.id ? ' on' : ''}`} onClick={() => setSubject(s.id)}>{s.title}</button>)}</div></div>
      <div className="ma-field">
        <label htmlFor="s-m">Durasi (menit)</label>
        <div className="ma-chips" style={{ marginBottom: 8 }}>{['15', '25', '30', '45', '60', '90'].map((m) => <button type="button" key={m} className={`ma-chip${minutes === m ? ' on' : ''}`} onClick={() => setMinutes(m)}>{m}</button>)}</div>
        <input id="s-m" className="ma-input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </div>
      <div className="ma-field"><label htmlFor="s-x">Materi</label><input id="s-x" className="ma-input" value={material} onChange={(e) => setMaterial(e.target.value)} maxLength={200} placeholder="Mis. Middleware & proxy" /></div>
      <Submit busy={busy}><Check size={18} />Catat sesi</Submit>
    </form>
  )
}

function Skeleton() {
  return (
    <div className="ma-wrap">
      <div className="ma-skel" style={{ aspectRatio: '3 / 1' }} />
      <div className="ma-skel" style={{ height: 52 }} />
      <div className="ma-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="ma-skel" style={{ height: 68 }} />)}</div>
      <div className="ma-skel" style={{ height: 210 }} />
    </div>
  )
}
