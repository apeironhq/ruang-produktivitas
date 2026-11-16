'use client'

import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/** Hanya satu pemilih terbuka dalam satu waktu: membuka yang lain menutup (dan menyimpan) yang ini. */
const OPEN_EVENT = 'dtp:open'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const TIMES = ['08:00', '10:00', '13:00', '17:00', '20:00']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }
const plusDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d) }

/** "Sen, 17 Nov 2026 · 17:00" */
function label(date: string, time: string) {
  const d = parseYmd(date)
  return `${DAY_NAMES[d.getDay()]!.slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()} · ${time}`
}

/**
 * Pengganti <input type="datetime-local">: pilihan cepat (Hari ini, Besok, …), kalender, jam,
 * dan tombol "Selesai" yang jelas untuk menutup. Nilainya dikirim lewat input tersembunyi
 * berformat sama dengan datetime-local ("YYYY-MM-DDTHH:mm"), jadi aksi server tidak berubah.
 */
export function DateTimePicker({ id, name, defaultValue = '', defaultTime = '09:00', invalid, required, placeholder = 'Pilih tanggal & jam' }: {
  id: string; name: string; defaultValue?: string; defaultTime?: string; invalid?: boolean; required?: boolean; placeholder?: string
}) {
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const today = ymd(new Date())
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState(defaultTime)
  const [view, setView] = useState(() => today.slice(0, 7))
  const panelId = useId()
  const root = useRef<HTMLDivElement | null>(null)

  // Klik di luar / pemilih lain dibuka / Esc → tutup. Pilihan yang sudah dibuat tetap disimpan (tidak hilang).
  useEffect(() => {
    if (!open) return
    const save = () => { if (draftDate) setValue(`${draftDate}T${draftTime || defaultTime}`); setOpen(false) }
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) save() }
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== panelId) save() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener(OPEN_EVENT, onOther)
    root.current?.addEventListener('keydown', onKey)
    const el = root.current
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener(OPEN_EVENT, onOther); el?.removeEventListener('keydown', onKey) }
  }, [open, panelId, defaultTime, draftDate, draftTime])

  function openPanel() {
    const [d, t] = value ? value.split('T') : ['', '']
    setDraftDate(d ?? '')
    setDraftTime(t?.slice(0, 5) || defaultTime)
    setView((d || today).slice(0, 7))
    setOpen(true)
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: panelId }))
  }
  function commit() {
    if (draftDate) setValue(`${draftDate}T${draftTime || defaultTime}`)
    setOpen(false)
  }
  function pickQuick(date: string) { setDraftDate(date); setView(date.slice(0, 7)) }

  // Grid bulan: Senin sebagai awal minggu.
  const [vy, vm] = view.split('-').map(Number) as [number, number]
  const first = new Date(vy, vm - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(vy, vm, 0).getDate()
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${view}-${pad(i + 1)}`)]
  const shiftMonth = (n: number) => { const d = new Date(vy, vm - 1 + n, 1); setView(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }

  const nextMonday = plusDays(today, ((8 - parseYmd(today).getDay()) % 7) || 7)
  const quick = [
    { label: 'Hari ini', date: today },
    { label: 'Besok', date: plusDays(today, 1) },
    { label: 'Lusa', date: plusDays(today, 2) },
    { label: 'Senin depan', date: nextMonday },
  ]

  return (
    <div ref={root} className="dtp">
      <input type="hidden" name={name} value={value} />
      <div className={`dtp-field${invalid ? ' has-error' : ''}${open ? ' is-open' : ''}`}>
        <button id={id} type="button" className="dtp-trigger" aria-expanded={open} aria-controls={panelId}
          onClick={() => (open ? setOpen(false) : openPanel())}>
          <CalendarDays size={16} aria-hidden="true" />
          <span className={value ? 'dtp-value' : 'dtp-placeholder'}>{value ? label(value.slice(0, 10), value.slice(11, 16)) : placeholder}</span>
        </button>
        {value && !required && (
          <button type="button" className="dtp-clear" aria-label="Kosongkan" onClick={() => { setValue(''); setOpen(false) }}><X size={15} /></button>
        )}
      </div>

      {open && (
        <div id={panelId} className="dtp-panel" role="group" aria-label="Pilih tanggal dan jam">
          <div className="dtp-quick">
            {quick.map((q) => (
              <button key={q.label} type="button" className={`dtp-chip${draftDate === q.date ? ' on' : ''}`} onClick={() => pickQuick(q.date)}>{q.label}</button>
            ))}
          </div>

          <div className="dtp-cal">
            <div className="dtp-cal-head">
              <button type="button" className="dtp-nav" aria-label="Bulan sebelumnya" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
              <span className="dtp-month">{MONTHS[vm - 1]} {vy}</span>
              <button type="button" className="dtp-nav" aria-label="Bulan berikutnya" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
            </div>
            <div className="dtp-grid">
              {DOW.map((d) => <span key={d} className="dtp-dow">{d}</span>)}
              {cells.map((c, i) => c === null ? <span key={`e${i}`} /> : (
                <button key={c} type="button" aria-label={label(c, draftTime).split(' · ')[0]} aria-pressed={draftDate === c}
                  className={`dtp-day${draftDate === c ? ' on' : ''}${c === today ? ' today' : ''}${c < today ? ' past' : ''}`}
                  onClick={() => setDraftDate(c)}>{Number(c.slice(8))}</button>
              ))}
            </div>
          </div>

          <div className="dtp-time">
            <span className="dtp-time-label">Jam</span>
            <div className="dtp-quick">
              {TIMES.map((t) => <button key={t} type="button" className={`dtp-chip${draftTime === t ? ' on' : ''}`} onClick={() => setDraftTime(t)}>{t}</button>)}
              <input type="time" className="input dtp-time-input" aria-label="Jam lain" value={draftTime} onChange={(e) => setDraftTime(e.target.value)} />
            </div>
          </div>

          <div className="dtp-foot">
            <span className="dtp-summary">{draftDate ? label(draftDate, draftTime || defaultTime) : 'Belum memilih tanggal'}</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Batal</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!draftDate} onClick={commit}>Selesai</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
