import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

/**
 * Kartu ringkasan Bot Telegram (gambar PNG, dirender next/og di server).
 * Telegram tidak bisa menampilkan HTML kaya di chat, jadi "dashboard" dikirim sebagai gambar
 * + tombol inline di bawahnya.
 */

export interface CardAgendaItem { title: string; time: string; late: boolean; event: boolean }
export interface CardData {
  greeting: string
  name: string
  dateLabel: string
  stats: { tasks: number; sessions: number; expense: string; goals: number }
  agenda: CardAgendaItem[]
  more: number
}

const W = 1080
const C = {
  bg: '#0f1a2d', panel: '#16233a', panel2: '#1a2943', line: '#273a58', text: '#f3f6fb', muted: '#a9b6cb', faint: '#7d8ba3',
  blue: '#3b82f6', lilac: '#8b7cf6', green: '#22b07d', peach: '#f0a43a', red: '#e5484d',
}

let assets: Promise<{ header: string; regular: Buffer; medium: Buffer }> | null = null
function loadAssets() {
  assets ??= Promise.all([
    readFile(join(process.cwd(), 'assets/bot/header.jpg')),
    readFile(join(process.cwd(), 'public/fonts/ubuntu-400.woff')),
    readFile(join(process.cwd(), 'public/fonts/ubuntu-500.woff')),
  ]).then(([h, regular, medium]) => ({ header: `data:image/jpeg;base64,${h.toString('base64')}`, regular, medium }))
  assets.catch(() => { assets = null })
  return assets
}

/* Ikon garis (jalur lucide), digambar sebagai SVG inline. */
const ICONS: Record<string, React.ReactNode> = {
  check: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></>,
  book: <><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></>,
  wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
}
function Icon({ name, size, color }: { name: string; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  )
}

function Stat({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, padding: '22px 14px', borderRadius: 24, background: C.panel, border: `2px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: color, flexShrink: 0 }}>
        <Icon name={icon} size={28} color="#ffffff" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 19, color: C.muted, whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: value.length > 11 ? 26 : value.length > 8 ? 30 : 36, fontWeight: 500, color: C.text, marginTop: 4 }}>{value}</span>
      </div>
    </div>
  )
}

const ROW_H = 76

export async function renderDashboardCard(d: CardData): Promise<Buffer> {
  const a = await loadAssets()
  const rows = Math.max(d.agenda.length, 1)
  const height = 360 + 150 + 178 + 40 + 104 + rows * ROW_H + (d.more ? 58 : 0) + 24 + 96

  const img = new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: W, height, background: C.bg, fontFamily: 'Ubuntu', color: C.text }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={a.header} width={W} height={360} style={{ width: W, height: 360, objectFit: 'cover' }} />

        <div style={{ display: 'flex', flexDirection: 'column', padding: '40px 36px 0' }}>
          <span style={{ fontSize: 46, fontWeight: 500 }}>{`${d.greeting}, ${d.name}! 👋`}</span>
          <span style={{ fontSize: 26, color: C.muted, marginTop: 10 }}>Berikut ringkasan aktivitas dan perkembanganmu hari ini.</span>
        </div>

        <div style={{ display: 'flex', gap: 14, padding: '34px 36px 0' }}>
          <Stat icon="check" color={C.blue} label="Tugas Aktif" value={String(d.stats.tasks)} />
          <Stat icon="book" color={C.lilac} label="Belajar Hari Ini" value={`${d.stats.sessions} sesi`} />
          <Stat icon="wallet" color={C.green} label="Pengeluaran" value={d.stats.expense} />
          <Stat icon="target" color={C.peach} label="Target Aktif" value={String(d.stats.goals)} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', margin: '40px 36px 0', borderRadius: 26, background: C.panel, border: `2px solid ${C.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: `2px solid ${C.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Icon name="calendar" size={34} color={C.text} />
              <span style={{ fontSize: 32, fontWeight: 500 }}>Agenda Hari Ini</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 999, background: C.panel2, border: `2px solid ${C.line}` }}>
              <Icon name="calendar" size={24} color={C.muted} />
              <span style={{ fontSize: 22, color: C.text }}>{d.dateLabel}</span>
            </div>
          </div>
          {d.agenda.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, padding: '0 28px', fontSize: 26, color: C.muted }}>
              Tidak ada tugas atau kegiatan hari ini. Nikmati harimu!
            </div>
          ) : d.agenda.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, height: ROW_H, padding: '0 28px', borderTop: i ? `2px solid ${C.line}` : 'none' }}>
              {it.event
                ? <Icon name="clock" size={30} color={C.lilac} />
                : <div style={{ display: 'flex', width: 28, height: 28, borderRadius: 7, border: `3px solid ${C.muted}`, flexShrink: 0 }} />}
              <span style={{ fontSize: 27, color: C.text, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{it.title}</span>
              {it.late && <span style={{ display: 'flex', fontSize: 20, padding: '6px 14px', borderRadius: 999, background: '#5c1f2a', color: '#ffb3b8', flexShrink: 0 }}>Terlambat</span>}
              <span style={{ fontSize: 25, color: it.late ? '#ffb3b8' : C.muted, flexShrink: 0, marginLeft: 6 }}>{it.time}</span>
            </div>
          ))}
          {d.more > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', height: 58, padding: '0 28px', borderTop: `2px solid ${C.line}`, fontSize: 23, color: C.faint }}>
              {`+${d.more} lainnya — ketuk "Tugas Saya" untuk melihat semua`}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, fontSize: 21, color: C.faint }}>
          Rupi · Ruang Produktivitas
        </div>
      </div>
    ),
    {
      width: W,
      height,
      fonts: [
        { name: 'Ubuntu', data: a.regular, weight: 400, style: 'normal' },
        { name: 'Ubuntu', data: a.medium, weight: 500, style: 'normal' },
      ],
    },
  )
  return Buffer.from(await img.arrayBuffer())
}
