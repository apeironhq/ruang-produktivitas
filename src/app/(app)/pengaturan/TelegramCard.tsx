'use client'

import { Copy, ExternalLink, Link2, Unlink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ConfirmButton, useRunAction } from '@/components/ui/actions'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
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
      <div className="flex flex-col gap-4">
        <div className="tg-linked">
          <span className="meta-status tone-brand">Tertaut</span>
          <p className="item-title mt-1">{info.connection.username ? `@${info.connection.username}` : 'Akun Telegram'}</p>
          <p className="item-sub">Sejak {info.connection.linkedLabel} · pengingat & ringkasan dikirim ke chat ini</p>
        </div>
        <ConfirmButton action={unlinkTelegram} title="Putuskan Telegram?" confirmLabel="Putuskan" className="btn btn-danger-ghost btn-block"
          message="Bot tidak bisa lagi membaca atau menambah data Anda, dan pengingat berhenti dikirim. Anda bisa menautkan lagi kapan saja.">
          <Unlink size={16} />Putuskan Telegram
        </ConfirmButton>
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
        <button type="button" className="btn btn-primary btn-block" disabled={pending} aria-busy={pending}
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

export function NotificationForm({ digest, digestTime }: { digest: boolean; digestTime: string }) {
  const { onSubmit, pending, errors } = useFormAction(saveNotifications)
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <label className="choice">
        <input type="checkbox" name="digest" defaultChecked={digest} />
        <span className="min-w-0">
          <span className="choice-title">Kirim ringkasan harian</span>
          <span className="choice-desc">Agenda hari ini, tugas terlambat, dan kebiasaan yang belum di-check-in.</span>
        </span>
      </label>
      <Field label="Jam kirim ringkasan" name="digest_time" error={errors.digest_time} hint="Mengikuti zona waktu profil. Pengingat tiap tugas diatur di kolom “Ingatkan”.">
        <input id="digest_time" name="digest_time" type="time" className={`input${errClass(errors, 'digest_time')}`} defaultValue={digestTime} required />
      </Field>
      <div><SubmitButton pending={pending} variant="secondary">Simpan preferensi</SubmitButton></div>
    </form>
  )
}
