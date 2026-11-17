import Link from 'next/link'
import { ArrowLeft, Inbox, TrendingDown, TrendingUp } from 'lucide-react'
import { formatByUnit, formatCompact, formatDuration, formatNumber } from '@/lib/format'
import { Sparkline } from './charts'

/** Ikon bernada lembut: warna modul (dari palet) di atas latar 14% warna yang sama. */
// Navy 14% terlihat abu-abu kusam → latarnya memakai langit (#8ECAE6) dari palet yang sama.
export const tint = (color = 'var(--brand)'): React.CSSProperties => /lilac|navy/.test(color)
  ? { color: 'var(--p-navy)', background: 'color-mix(in srgb, var(--p-sky) 32%, transparent)' }
  : { color: `color-mix(in srgb, ${color} 82%, #000)`, background: `color-mix(in srgb, ${color} 14%, transparent)` }
/** Ikon solid untuk kartu KPI: lingkaran warna palet, simbol putih (navy di atas kuning agar terbaca). */
const LIGHT = /rose|amber|sky/
export const solid = (color = 'var(--brand)'): React.CSSProperties => ({ background: color, color: LIGHT.test(color) ? 'var(--p-navy)' : '#fff' })

export function EmptyState({ title, description, icon, action, className = '' }: {
  title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode; className?: string
}) {
  return (
    <div className={`empty ${className}`}>
      <span className="empty-mark" aria-hidden="true">{icon ?? <Inbox size={20} strokeWidth={1.75} />}</span>
      <span className="empty-title">{title}</span>
      {description && <span className="empty-desc">{description}</span>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/**
 * Kartu KPI: ikon bernada, label, angka besar, pill perubahan vs periode sebelumnya, lalu SALAH SATU pelengkap:
 * sparkline (angka harian) atau progress bar (persen / x dari y). Kartu tanpa pembanding cukup keterangan.
 */
export function KpiCard({ label, value, unit, icon, color, series = [], thisWeek, lastWeek, caption, note, href, display, duration, money, invert, progress, progressColor, compare = ['7 hari sebelumnya', '7 hari lalu'] }: {
  label: string; value: number | null; unit?: string; icon: React.ReactNode; color: string
  series?: number[]; thisWeek?: number; lastWeek?: number; caption?: string; href?: string; display?: string
  /** label pembanding [panjang, pendek] */
  compare?: [string, string]
  /** nilai berupa menit → selisih ditulis "+1 j 20 m", bukan "+80 baru" */
  duration?: boolean
  /** nilai rupiah → selisih ditulis "+Rp1,5 jt" bila periode lalu nol */
  money?: boolean
  /** naik itu buruk (mis. pengeluaran): pill naik berwarna merah, turun hijau */
  invert?: boolean
  /** 0–100: tampilkan progress bar (untuk persen / x dari y) */
  progress?: number
  progressColor?: string
  /** keterangan di bawah angka saat ada pill (menggantikan "Dibanding …") */
  note?: string
}) {
  let delta: { up: boolean; text: string; flat: boolean } | null = null
  if (thisWeek !== undefined && lastWeek !== undefined) {
    const diff = thisWeek - lastWeek
    // Persen tidak bermakna bila pembanding 0 atau nilai uang berganti tanda (mis. saldo jadi minus) → tampilkan selisihnya.
    if (lastWeek === 0 || (money && (lastWeek < 0 || thisWeek < 0))) {
      const abs = Math.abs(diff)
      const amt = duration ? formatDuration(abs) : money ? `Rp${formatCompact(abs)}` : formatNumber(abs)
      delta = { up: diff >= 0, text: diff > 0 ? (duration || money ? `+${amt}` : `+${amt} baru`) : diff < 0 ? `−${amt}` : 'Tetap', flat: diff === 0 }
    }
    else {
      const pct = Math.round((diff / Math.abs(lastWeek)) * 100)
      delta = { up: pct >= 0, text: `${pct > 0 ? '+' : ''}${pct}%`, flat: pct === 0 }
    }
  }
  // Ponsel: kartu bergrafik selebar layar; kartu ringkas (angka / progress bar) dua kolom.
  const kind = series.length > 0 && progress === undefined ? 'has-spark' : 'compact'
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-icon" style={solid(color)} aria-hidden="true">{icon}</span>
        <span className="kpi-label">{label}</span>
        {delta && (
          <span className={`kpi-pill${delta.flat ? '' : delta.up !== !!invert ? ' up' : ' down'}`}>
            {!delta.flat && (delta.up ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />)}{delta.text}
          </span>
        )}
      </div>
      <div className="kpi-body">
        <div className="min-w-0">
          <span className="kpi-value" style={{ '--chars': (display ?? (value === null ? '—' : formatNumber(value))).length + (unit ? unit.length + 1 : 0) } as React.CSSProperties}>{display ?? (value === null ? '—' : formatNumber(value))}{unit && <span className="kpi-unit">{unit}</span>}</span>
          {delta ? (note ? <p className="kpi-delta muted">{note}</p> : <p className="kpi-delta muted"><span className="long">Dibanding {compare[0]}</span><span className="short">vs {compare[1]}</span></p>)
            : caption ? <p className="kpi-delta muted">{caption}</p> : null}
        </div>
        {series.length > 0 && progress === undefined && <Sparkline values={series} color={color} />}
      </div>
      {progress !== undefined && (
        <div className="kpi-progress">
          <ProgressBar percent={progress} color={progressColor ?? color} label={`Progres ${label}`} />
        </div>
      )}
    </>
  )
  return href
    ? <Link href={href} className={`kpi card clickable ${kind}`}>{body}</Link>
    : <div className={`kpi card ${kind}`}>{body}</div>
}

/** Donut dengan celah 2px antar-segmen, total di tengah, legenda selalu ada (warna + label + angka + persen). */
export function DonutChart({ segments, centerLabel = 'Total', size = 148, unit = '' }: { segments: Array<{ label: string; value: number; color: string }>; centerLabel?: string; size?: number; unit?: string }) {
  const stroke = 18
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((n, s) => n + s.value, 0)
  const nonZero = segments.filter((s) => s.value > 0).length
const lens = segments.map((s) => (total ? (s.value / total) * c : 0))
  const arcs = segments.map((s, i) => {
    const len = lens[i]!
    const gap = nonZero > 1 && len > 0 ? 2 : 0
    const before = lens.slice(0, i).reduce((n, l) => n + l, 0)
    return { ...s, dash: `${Math.max(len - gap, 0)} ${c}`, offset: -before }
  })
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--n-100)" strokeWidth={stroke} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map((a) => (
              <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeDasharray={a.dash} strokeDashoffset={a.offset} />
            ))}
          </g>
        </svg>
        <div className="donut-center"><strong title={formatByUnit(total, unit)} className={formatByUnit(total, unit, true).length > 6 ? 'long' : undefined}>{formatByUnit(total, unit, true)}</strong><span>{centerLabel}</span></div>
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="name">{s.label}</span>
            <span className="val">{formatByUnit(s.value, unit)}</span>
            <span className="pct">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProgressBar({ percent, color, label, large }: { percent: number; color?: string; label: string; large?: boolean }) {
  const p = Math.min(100, Math.max(0, percent))
  return (
    <div className={`bar${large ? ' bar-lg' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}
      style={color ? ({ '--bar-color': color } as React.CSSProperties) : undefined}>
      <span style={{ width: `${p}%` }} />
    </div>
  )
}

export function Badge({ tone, children, dot = true }: { tone: string; children: React.ReactNode; dot?: boolean }) {
  return <span className={`badge${dot ? ' badge-dot' : ''} ${tone}`}>{children}</span>
}

export function PageHead({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p className="text-caption page-desc">{description}</p>}
      </div>
      {actions && <div className="control-row">{actions}</div>}
    </div>
  )
}

/**
 * Kepala halaman detail (pola MDUNDIG): judul dulu, lalu satu baris keterangan kecil dipisah "·".
 * Status ditulis sebagai teks bertitik warna, bukan kotak badge di atas judul.
 */
export function DetailTitle({ title, status, meta = [], desc }: {
  title: string; status?: { label: string; tone: string }; meta?: React.ReactNode[]; desc?: string
}) {
  const items = meta.filter((m) => m !== null && m !== undefined && m !== false && m !== '')
  return (
    <div className="min-w-0">
      <h1 className="break-words">{title}</h1>
      <p className="detail-meta">
        {status && <span className={`meta-status ${status.tone}`}>{status.label}</span>}
        {items.map((m, i) => <span key={i}>{m}</span>)}
      </p>
      {desc && <p className="text-caption mt-2 max-w-[70ch]">{desc}</p>}
    </div>
  )
}

/** Tombol kembali halaman detail (pola MDUNDIG: btn ghost kecil + panah kiri). */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="btn btn-ghost btn-sm self-start -ml-3"><ArrowLeft size={16} />{children}</Link>
}

/** Kepala kartu seragam: ikon 18px + judul + keterangan, aksi di kanan (card-header MDUNDIG). */
/** `quiet`: keterangan hanya petunjuk statis → disembunyikan di ponsel agar isi naik ke atas. */
export function SectionHead({ id, icon, title, desc, quiet, children }: { id?: string; icon?: React.ReactNode; title: string; desc?: React.ReactNode; quiet?: boolean; children?: React.ReactNode }) {
  return (
    <div className="card-header">
      <div className="min-w-0">
        <h2 id={id}>{icon}{title}</h2>
        {desc && <p className={`text-caption${quiet ? ' desc-quiet' : ''}`}>{desc}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  )
}

/** Kaki kartu: jumlah item yang ditampilkan. */
export function CountFoot({ shown, total, noun = 'item' }: { shown: number; total?: number; noun?: string }) {
  return (
    <div className="card-foot">
      <p className="text-caption">Menampilkan <strong>{formatNumber(shown)}</strong>{total !== undefined && total !== shown ? <> dari <strong>{formatNumber(total)}</strong></> : null} {noun}</p>
    </div>
  )
}

/**
 * Daftar informasi untuk panel samping halaman detail: label di kiri, nilai di kanan, dipisah garis tipis.
 * Baris dengan nilai kosong (null/undefined/false/'') tidak ditampilkan; '—' tetap tampil sebagai penanda.
 */
export function InfoList({ items }: { items: Array<[string, React.ReactNode] | null | false> }) {
  const rows = items.filter((r): r is [string, React.ReactNode] => !!r && r[1] !== null && r[1] !== undefined && r[1] !== false && r[1] !== '')
  return (
    <dl className="info-list">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  )
}

/** Kotak angka kecil (ringkasan di dalam kartu), mis. harga masuk/keluar jurnal trading. */
export function StatTile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'err' }) {
  return (
    <div className={`stat-tile${tone ? ` ${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}
