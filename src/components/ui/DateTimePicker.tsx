'use client'

import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/** Hanya satu pemilih terbuka dalam satu waktu: membuka yang lain menutup (dan menyimpan) yang ini. */
const OPEN_EVENT = 'dtp:open'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }
const plusDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d) }

/** "Sel, 17 Nov 2026" */
function dateLabel(date: string) {
  const d = parseYmd(date)
  return `${DAY_NAMES[d.getDay()]!.slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`
}

type Mode = 'datetime' | 'date' | 'time'

/** Pecah nilai sesuai mode → [tanggal, jam]. */
function split(mode: Mode, v: string): [string, string] {
  if (!v) return ['', '']
  if (mode === 'time') return ['', v.slice(0, 5)]
  if (mode === 'date') return [v.slice(0, 10), '']
  const [d, t] = v.split('T')
  return [d ?? '', (t ?? '').slice(0, 5)]
}
function join(mode: Mode, date: string, time: string) {
  return mode === 'time' ? time : mode === 'date' ? date : `${date}T${time}`
}
function display(mode: Mode, v: string) {
  const [d, t] = split(mode, v)
  return mode === 'time' ? t : mode === 'date' ? dateLabel(d) : `${dateLabel(d)} · ${t}`
}

/**
 * Pemilih tanggal/jam seragam untuk semua form (pengganti input date/time/datetime-local bawaan browser):
 * pilihan cepat, kalender, jam & menit, serta tombol "Selesai" yang jelas. Klik di luar juga menyimpan.
 * Nilai dikirim lewat input tersembunyi dengan format yang sama seperti input bawaan
 * ("YYYY-MM-DDTHH:mm" / "YYYY-MM-DD" / "HH:mm"), jadi aksi server tidak berubah.
 *
 * quick: 'future' (Hari ini, Besok, …) untuk tenggat & jadwal; 'past' (Hari ini, Kemarin, …) untuk catatan kejadian.
 */
export function DateTimePicker({ id, name, defaultValue = '', defaultTime = '09:00', mode = 'datetime', quick = 'future', invalid, required, placeholder, onChange }: {
  id: string; name: string; defaultValue?: string; defaultTime?: string; mode?: Mode; quick?: 'future' | 'past'
  invalid?: boolean; required?: boolean; placeholder?: string; onChange?: (value: string) => void
}) {
  const [value, setValueRaw] = useState(defaultValue)
  const setValue = (v: string) => { setValueRaw(v); onChange?.(v) }
  const [open, setOpen] = useState(false)
  const today = ymd(new Date())
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState(defaultTime)
  const [view, setView] = useState(() => today.slice(0, 7))
  const panelId = useId()
  const root = useRef<HTMLDivElement | null>(null)
  const hasDate = mode !== 'time'
  const hasTime = mode !== 'date'
  const ready = hasDate ? !!draftDate : !!draftTime
  const draftValue = ready ? join(mode, draftDate, draftTime || defaultTime) : ''

  // Klik di luar / pemilih lain dibuka → simpan pilihan & tutup. Esc → batal.
  useEffect(() => {
    if (!open) return
    const save = () => { if (draftValue) { setValueRaw(draftValue); onChange?.(draftValue) } setOpen(false) }
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) save() }
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== panelId) save() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener(OPEN_EVENT, onOther)
    const el = root.current
    el?.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener(OPEN_EVENT, onOther); el?.removeEventListener('keydown', onKey) }
  }, [open, panelId, draftValue, onChange])

  function openPanel() {
    const [d, t] = split(mode, value)
    setDraftDate(d)
    setDraftTime(t || defaultTime)
    setView((d || today).slice(0, 7))
    setOpen(true)
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: panelId }))
  }
  function commit() {
    if (draftValue) setValue(draftValue)
    setOpen(false)
  }
  function pickQuick(date: string) { setDraftDate(date); setView(date.slice(0, 7)) }

  // Grid bulan: Senin sebagai awal minggu.
  const [vy, vm] = view.split('-').map(Number) as [number, number]
  const lead = (new Date(vy, vm - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(vy, vm, 0).getDate()
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${view}-${pad(i + 1)}`)]
  const shiftMonth = (n: number) => { const d = new Date(vy, vm - 1 + n, 1); setView(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) }

  const nextMonday = plusDays(today, ((8 - parseYmd(today).getDay()) % 7) || 7)
  const quickDates = quick === 'past'
    ? [{ label: 'Hari ini', date: today }, { label: 'Kemarin', date: plusDays(today, -1) }, { label: '2 hari lalu', date: plusDays(today, -2) }, { label: 'Minggu lalu', date: plusDays(today, -7) }]
    : [{ label: 'Hari ini', date: today }, { label: 'Besok', date: plusDays(today, 1) }, { label: 'Lusa', date: plusDays(today, 2) }, { label: 'Senin depan', date: nextMonday }]
  const quickTimes = mode === 'time' ? ['06:00', '07:00', '08:00', '12:00', '18:00', '20:00'] : ['08:00', '10:00', '13:00', '17:00', '20:00']
  const [hh, mm] = (draftTime || defaultTime).split(':') as [string, string]
  const setPart = (h: string, m: string) => setDraftTime(`${h}:${m}`)

  const Icon = mode === 'time' ? Clock : CalendarDays
  const ph = placeholder ?? (mode === 'time' ? 'Pilih jam' : mode === 'date' ? 'Pilih tanggal' : 'Pilih tanggal & jam')

  return (
    <div ref={root} className="dtp">
      <input type="hidden" name={name} value={value} />
      <div className={`dtp-field${invalid ? ' has-error' : ''}${open ? ' is-open' : ''}`}>
        <button id={id} type="button" className="dtp-trigger" aria-expanded={open} aria-controls={panelId}
          onClick={() => (open ? setOpen(false) : openPanel())}>
          <Icon size={16} aria-hidden="true" />
          <span className={value ? 'dtp-value' : 'dtp-placeholder'}>{value ? display(mode, value) : ph}</span>
        </button>
        {value && !required && (
          <button type="button" className="dtp-clear" aria-label="Kosongkan" onClick={() => { setValue(''); setOpen(false) }}><X size={15} /></button>
        )}
      </div>

      {open && (
        <div id={panelId} className="dtp-panel" role="group" aria-label={ph}>
          {hasDate && (
            <>
              <div className="dtp-quick">
                {quickDates.map((q) => (
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
                    <button key={c} type="button" aria-label={dateLabel(c)} aria-pressed={draftDate === c}
                      className={`dtp-day${draftDate === c ? ' on' : ''}${c === today ? ' today' : ''}${quick === 'future' && c < today ? ' past' : ''}`}
                      onClick={() => setDraftDate(c)}>{Number(c.slice(8))}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {hasTime && (
            <div className={`dtp-time${hasDate ? '' : ' solo'}`}>
              <span className="dtp-time-label">Jam</span>
              <div className="dtp-quick">
                {quickTimes.map((t) => <button key={t} type="button" className={`dtp-chip${draftTime === t ? ' on' : ''}`} onClick={() => setDraftTime(t)}>{t}</button>)}
              </div>
              <div className="dtp-hm">
                <select className="select dtp-sel" aria-label="Jam" value={hh} onChange={(e) => setPart(e.target.value, mm)}>
                  {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span aria-hidden="true">:</span>
                <select className="select dtp-sel" aria-label="Menit" value={mm} onChange={(e) => setPart(hh, e.target.value)}>
                  {!MINUTES.includes(mm) && <option value={mm}>{mm}</option>}
                  {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="dtp-foot">
            <span className="dtp-summary">{draftValue ? display(mode, draftValue) : 'Belum memilih tanggal'}</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Batal</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!draftValue} onClick={commit}>Selesai</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
