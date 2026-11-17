'use client'

import { ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmButton, useRunAction } from '@/components/ui/actions'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { deleteAiKey, saveAiKey, setAiEnabled } from './ai-actions'

export interface AiInfo { enabled: boolean; hint: string; updatedLabel: string }

export function AiCard({ info, telegram }: { info: AiInfo | null; telegram: boolean }) {
  const [replacing, setReplacing] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption">
        Saat aktif, pesan bebas ke bot Rupi dipahami AI Gemini — satu pesan bisa langsung jadi beberapa catatan sekaligus,
        mis. <em>“besok jam 9 rapat tim, tadi beli bensin 20rb”</em>. Tetap ada konfirmasi sebelum disimpan.
        {!telegram && ' Tautkan Telegram terlebih dahulu agar asisten bisa dipakai.'}
      </p>

      {info ? (
        <>
          <div className="tg-linked">
            <span className={`meta-status ${info.enabled ? 'tone-brand' : 'tone-neutral'}`}>{info.enabled ? 'Aktif' : 'Nonaktif'}</span>
            <p className="item-title mt-1">Gemini · kunci ••••{info.hint}</p>
            <p className="item-sub">Disimpan {info.updatedLabel} · terenkripsi, tidak bisa dilihat lagi</p>
          </div>
          <EnabledToggle on={info.enabled} />
          {replacing ? <KeyForm label="Kunci API baru" onDone={() => setReplacing(false)} /> : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setReplacing(true)}><KeyRound size={16} />Ganti kunci</button>
              <ConfirmButton action={deleteAiKey} title="Hapus kunci Gemini?" confirmLabel="Hapus" className="btn btn-secondary is-danger"
                message="Asisten AI akan nonaktif dan bot kembali ke mode biasa. Anda bisa menempelkan kunci lagi kapan saja.">
                <Trash2 size={16} />Hapus kunci
              </ConfirmButton>
            </div>
          )}
        </>
      ) : (
        <>
          <ol className="steps-list">
            <li>Buka <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="link">Google AI Studio <ExternalLink size={12} className="inline" /></a> dan masuk dengan akun Google.</li>
            <li>Tekan <strong>Create API key</strong>, lalu salin kuncinya.</li>
            <li>Tempel di bawah — Rupi mengujinya dulu sebelum menyimpan.</li>
          </ol>
          <KeyForm label="Kunci API Gemini" />
        </>
      )}

      <p className="text-caption">
        Setiap akun memakai kuncinya sendiri, jadi kuota & biaya mengikuti akun Google Anda. Pada tingkat gratis Gemini,
        Google dapat memakai isi permintaan untuk meningkatkan layanannya — hindari menulis data sangat rahasia lewat asisten.
      </p>
    </div>
  )
}

function KeyForm({ label, onDone }: { label: string; onDone?: () => void }) {
  const { onSubmit, pending, errors } = useFormAction(saveAiKey, { onSuccess: () => onDone?.() })
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label={label} name="ai-key" error={errors.key} hint="Biasanya diawali “AIza”. Kunci hanya dikirim ke Google untuk diuji, lalu disimpan terenkripsi.">
        <input id="ai-key" name="key" type="password" autoComplete="off" spellCheck={false} placeholder="AIza…" className={`input${errClass(errors, 'key')}`} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} loadingText="Menguji kunci…">Simpan & aktifkan</SubmitButton>
        {onDone && <button type="button" className="btn btn-secondary" onClick={onDone}>Batal</button>}
      </div>
    </form>
  )
}

function EnabledToggle({ on }: { on: boolean }) {
  const { pending, run } = useRunAction()
  return (
    <label className="choice">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => run(() => setAiEnabled(e.target.checked))} />
      <span className="min-w-0">
        <span className="choice-title">Aktifkan Asisten AI di bot</span>
        <span className="choice-desc">Matikan untuk kembali ke mode biasa tanpa menghapus kunci.</span>
      </span>
    </label>
  )
}
