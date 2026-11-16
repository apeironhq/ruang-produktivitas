'use client'

import { BellRing, CheckCircle2, Copy, ExternalLink, MessageSquareText, Send, Sun } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { TelegramPromptState } from '@/lib/telegram-prompt'
import { checkTelegramConnected, createLinkCode, rememberTelegramPromptDecided, setTelegramPrompt, snoozeTelegramPrompt } from './pengaturan/telegram-actions'

type Phase = 'ajak' | 'menunggu' | 'tersambung'

/**
 * Ajakan menyambungkan Telegram, muncul setelah masuk bila belum tersambung.
 * "Sambungkan sekarang" membuka t.me/<bot>?start=<kode> → bot menautkan otomatis (tanpa mengetik kode).
 * "Nanti saja" → muncul lagi 3 hari kemudian; "Jangan tampilkan lagi" → mati (bisa dinyalakan di Pengaturan).
 */
export function TelegramPrompt({ state }: { state: TelegramPromptState }) {
  const rememberSec = state.show ? 0 : state.rememberSec
  // Tidak perlu tampil: simpan cookie agar halaman berikutnya tidak memeriksa ulang.
  useEffect(() => {
    if (rememberSec > 0) void rememberTelegramPromptDecided(rememberSec)
  }, [rememberSec])
  if (!state.show) return null
  return <Prompt bot={state.bot} />
}

function Prompt({ bot }: { bot: string }) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('ajak')
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const decided = useRef(false)
  const toast = useToast()
  const router = useRouter()

  function refreshCode() {
    createLinkCode().then((r) => ('error' in r ? setError(r.error) : setCode(r))).catch(() => setError('Gagal menyiapkan tautan. Coba lagi nanti.'))
  }

  // Tampil sebentar setelah halaman terbuka; kode tautan disiapkan sejak awal.
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 900)
    refreshCode()
    return () => clearTimeout(t)
  }, [])

  // Menunggu konfirmasi dari Telegram.
  useEffect(() => {
    if (phase !== 'menunggu' || !code) return
    const stopAt = new Date(code.expiresAt).getTime()
    const t = setInterval(async () => {
      if (Date.now() > stopAt) { clearInterval(t); setPhase('ajak'); setError('Waktu tautan habis. Tekan "Sambungkan sekarang" lagi.'); refreshCode(); return }
      if (await checkTelegramConnected().catch(() => false)) {
        clearInterval(t)
        decided.current = true
        setPhase('tersambung')
        toast.success('Telegram tersambung.')
      }
    }, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, code])

  function later() {
    if (!decided.current) { decided.current = true; void snoozeTelegramPrompt() }
    setOpen(false)
  }
  async function never() {
    decided.current = true
    setOpen(false)
    const r = await setTelegramPrompt(false).catch(() => null)
    if (r?.ok) toast.success('Oke, tidak akan ditampilkan lagi. Bisa disambungkan kapan saja di Pengaturan.')
  }
  function done() {
    setOpen(false)
    router.refresh()
  }

  const link = code && bot ? `https://t.me/${bot}?start=${code.code}` : null

  if (phase === 'tersambung') {
    return (
      <Modal open={open} onClose={done} title="Telegram tersambung" subtitle="Rupi siap mengingatkan Anda." icon={<CheckCircle2 size={18} />} size="sm"
        footer={<button type="button" className="btn btn-primary" onClick={done}>Selesai</button>}>
        <p className="text-body">Pengingat tugas, timer, ringkasan pagi, dan cek tugas sore kini dikirim ke chat <strong>@{bot}</strong>. Ketik <code>/menu</code> di sana untuk mulai.</p>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={later} title="Sambungkan Telegram" subtitle="Dapatkan pengingat & catat cepat langsung dari chat." icon={<Send size={18} />} size="md"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm mr-auto" onClick={never}>Jangan tampilkan lagi</button>
          <button type="button" className="btn btn-secondary" onClick={later}>Nanti saja</button>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="btn btn-primary" onClick={() => { setError(''); setPhase('menunggu') }}>
              <ExternalLink size={16} />Sambungkan sekarang
            </a>
          ) : (
            <button type="button" className="btn btn-primary" disabled aria-busy={!error}>
              {!error && <span className="spinner" aria-hidden="true" />}Sambungkan sekarang
            </button>
          )}
        </div>
      }>
      {phase === 'menunggu' && code ? (
        <div className="flex flex-col gap-4">
          <div className="alert" role="status">
            <p className="flex items-center gap-2"><span className="spinner" aria-hidden="true" /><strong>Menunggu konfirmasi dari Telegram…</strong></p>
            <p className="mt-1">Di Telegram, tekan <strong>Start</strong> pada chat <strong>@{bot}</strong>. Halaman ini akan berubah otomatis.</p>
          </div>
          <div className="text-caption">
            Telegram tidak terbuka? Kirim perintah ini ke <strong>@{bot}</strong>:
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1">/mulai {code.code}</code>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(`/mulai ${code.code}`); toast.success('Perintah disalin.') }}>
                <Copy size={14} />Salin
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            <Benefit icon={<BellRing size={17} />} title="Pengingat tepat waktu" desc="Tugas, kegiatan, dan timer dikirim sebagai notifikasi ke HP." />
            <Benefit icon={<Sun size={17} />} title="Ringkasan pagi & cek sore" desc="Agenda hari ini setiap pagi, dan tugas yang belum selesai setiap sore." />
            <Benefit icon={<MessageSquareText size={17} />} title="Catat cepat dari chat" desc="Tambah tugas, catatan, sesi belajar, dan pengeluaran tanpa membuka aplikasi." />
          </ul>
          <p className="text-caption">Cukup tekan <strong>Sambungkan sekarang</strong>, lalu <strong>Start</strong> di Telegram — akun tersambung otomatis. Hanya Anda yang bisa melihat data Anda.</p>
          {error && <p className="field-error">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function Benefit({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="tint-icon shrink-0" style={{ color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 10%, transparent)' }} aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="item-title block">{title}</span>
        <span className="item-sub block">{desc}</span>
      </span>
    </li>
  )
}
