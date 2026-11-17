'use client'

import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Copy, ExternalLink, Link2, Unlink } from 'lucide-react'

/** Perintah yang paling sering dipakai — ditampilkan sebagai panduan singkat di kartu Bot. */
const QUICK_COMMANDS: Array<[string, string]> = [
  ['/menu', 'Ringkasan hari ini & menu utama'],
  ['/tambah', 'Tugas baru, mis. servis motor besok jam 2'],
  ['/ingatkan', 'Pengingat, mis. tiap hari jam 7 minum obat'],
  ['/fokus', 'Pomodoro 25 menit fokus, 5 menit istirahat'],
]
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ConfirmButton, useRunAction } from '@/components/ui/actions'
import { SubmitButton, useFormAction } from '@/components/ui/forms'
import { useToast } from '@/components/ui/Toast'
import { createLinkCode, saveNotifications, setTelegramPrompt, unlinkTelegram } from './telegram-actions'

export interface TelegramInfo {
  configured: boolean
  bot: string
  connection: { username: string; linked_at: string; linkedLabel: string } | null
  /** popup ajakan setelah masuk aktif? */
  promptOn: boolean
}

export function TelegramLink({ info }: { info: TelegramInfo }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [pending, start] = useTransition()
  const toast = useToast()
  const router = useRouter()

  // Selama kode tampil, periksa berkala apakah bot sudah menautkan akun (halaman server dirender ulang).
  useEffect(() => {
    if (!code) return
    const stopAt = new Date(code.expiresAt).getTime()
    const t = setInterval(() => {
      if (Date.now() > stopAt) { clearInterval(t); setCode(null); return }
      router.refresh()
    }, 4000)
    return () => clearInterval(t)
  }, [code, router])

  if (!info.configured) {
    return <p className="text-caption">Bot Telegram belum diaktifkan di server. Setelah token bot dipasang, Anda bisa menautkan akun dari sini.</p>
  }

  if (info.connection) {
    return (
      <div className="flex flex-col">
        <div className="set-row">
          <div className="min-w-0">
            <p className="set-title">{info.connection.username ? `@${info.connection.username}` : 'Akun Telegram'} <span className="meta-status tone-brand">Tertaut</span></p>
            <p className="set-desc">Sejak {info.connection.linkedLabel} · pengingat & ringkasan dikirim ke chat ini</p>
          </div>
          <ConfirmButton action={unlinkTelegram} title="Putuskan Telegram?" confirmLabel="Putuskan" className="btn btn-secondary is-danger"
            message="Bot tidak bisa lagi membaca atau menambah data Anda, dan pengingat berhenti dikirim. Anda bisa menautkan lagi kapan saja.">
            <Unlink size={16} />Putuskan
          </ConfirmButton>
        </div>
        <p className="set-sub">Perintah cepat</p>
        <ul className="cmd-list">
          {QUICK_COMMANDS.map(([cmd, desc]) => <li key={cmd}><code>{cmd}</code><span>{desc}</span></li>)}
        </ul>
        {info.bot && (
          <div className="set-actions">
            <span className="text-caption">Atau ketik pesan bebas — Rupi memahaminya.</span>
            <a href={`https://t.me/${info.bot}`} target="_blank" rel="noreferrer" className="btn btn-secondary"><ExternalLink size={16} />Buka @{info.bot}</a>
          </div>
        )}
      </div>
    )
  }

  const deepLink = code && info.bot ? `https://t.me/${info.bot}?start=${code.code}` : null
  return (
    <div className="flex flex-col gap-4">
      <ol className="steps-list">
        <li>Tekan <strong>Buat kode tautan</strong> (berlaku 10 menit, sekali pakai).</li>
        <li>Buka bot{info.bot ? <> <strong>@{info.bot}</strong></> : ''} di Telegram lalu kirim <code>/mulai KODE</code> — atau tekan <strong>Buka di Telegram</strong>.</li>
        <li>Halaman ini otomatis berubah menjadi “Tertaut”.</li>
      </ol>
      {code ? (
        <div className="tg-code">
          <span className="tg-code-value" aria-label={`Kode ${code.code.split('').join(' ')}`}>{code.code}</span>
          <div className="flex flex-wrap gap-2 justify-center">
            {deepLink && <a href={deepLink} target="_blank" rel="noreferrer" className="btn btn-primary"><ExternalLink size={16} />Buka di Telegram</a>}
            <button type="button" className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(`/mulai ${code.code}`); toast.success('Perintah disalin.') }}>
              <Copy size={16} />Salin perintah
            </button>
          </div>
          <p className="text-caption flex items-center gap-2"><span className="spinner" aria-hidden="true" />Menunggu konfirmasi dari Telegram…</p>
        </div>
      ) : (
        <button type="button" className="btn btn-primary self-start" disabled={pending} aria-busy={pending}
          onClick={() => start(async () => {
            const res = await createLinkCode().catch(() => ({ error: 'Koneksi bermasalah. Coba lagi.' }))
            if ('error' in res) toast.error(res.error)
            else setCode(res)
          })}>
          {pending ? <span className="spinner" aria-hidden="true" /> : <Link2 size={16} />}Buat kode tautan
        </button>
      )}
      <PromptToggle on={info.promptOn} />
    </div>
  )
}

/** Nyalakan / matikan popup "Sambungkan Telegram" yang muncul setelah masuk. */
function PromptToggle({ on }: { on: boolean }) {
  const { pending, run } = useRunAction()
  return (
    <label className="choice">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => run(() => setTelegramPrompt(e.target.checked))} />
      <span className="min-w-0">
        <span className="choice-title">Ingatkan saya untuk menyambungkan Telegram</span>
        <span className="choice-desc">Tampilkan ajakan menyambungkan setelah masuk, sampai Telegram tersambung.</span>
      </span>
    </label>
  )
}

/** Notifikasi otomatis sebagai baris pengaturan: keterangan di kiri, kontrol (aktif + jam) di kanan. */
export function NotificationForm({ digest, digestTime, evening, eveningTime }: { digest: boolean; digestTime: string; evening: boolean; eveningTime: string }) {
  const { onSubmit, pending, errors } = useFormAction(saveNotifications)
  const rows = [
    { key: 'digest', title: 'Ringkasan pagi', desc: 'Agenda hari ini, tugas terlambat, dan kebiasaan yang belum di-check-in.', on: digest, time: digestTime },
    { key: 'evening', title: 'Cek tugas sore', desc: 'Tugas hari ini yang belum selesai — hanya dikirim bila masih ada.', on: evening, time: eveningTime },
  ]
  return (
    <form onSubmit={onSubmit} noValidate>
      {rows.map((r) => (
        <div key={r.key} className="set-row">
          <div className="min-w-0">
            <p className="set-title">{r.title}</p>
            <p className="set-desc">{r.desc}</p>
            {errors[`${r.key}_time`] && <p className="field-error">{errors[`${r.key}_time`]}</p>}
          </div>
          <div className="set-ctrl">
            <label className="set-check"><input type="checkbox" name={r.key} defaultChecked={r.on} />Aktif</label>
            <div className="set-time">
              <DateTimePicker id={`${r.key}_time`} name={`${r.key}_time`} mode="time" defaultValue={r.time} invalid={!!errors[`${r.key}_time`]} required aria-label={`Jam ${r.title.toLowerCase()}`} />
            </div>
          </div>
        </div>
      ))}
      <div className="set-row">
        <div className="min-w-0">
          <p className="set-title">Pengingat tugas & timer</p>
          <p className="set-desc">Diatur per tugas lewat kolom “Ingatkan”, atau kirim <code>/ingatkan</code> ke bot.</p>
        </div>
        <span className="set-note">Sesuai jadwal</span>
      </div>
      <div className="set-actions">
        <span className="text-caption">Jam mengikuti zona waktu profil.</span>
        <SubmitButton pending={pending} variant="secondary">Simpan</SubmitButton>
      </div>
    </form>
  )
}
