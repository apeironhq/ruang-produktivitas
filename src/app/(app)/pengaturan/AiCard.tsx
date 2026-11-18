'use client'

import { KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmButton, useRunAction } from '@/components/ui/actions'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { deleteAiKey, saveAiEndpoint, setAiEnabled, setAiShareData } from './ai-actions'

export interface AiInfo { enabled: boolean; hint: string; baseUrl: string; model: string; shareData: boolean; updatedLabel: string }

function hostOf(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

export function AiCard({ info, telegram }: { info: AiInfo | null; telegram: boolean }) {
  const [replacing, setReplacing] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      {!telegram && <p className="text-caption">Tautkan Telegram terlebih dahulu (bagian <strong>Telegram & Pengingat</strong>) agar asisten bisa dipakai di bot.</p>}

      {info ? (
        <>
          <div className="tg-linked">
            <span className={`meta-status ${info.enabled ? 'tone-brand' : 'tone-neutral'}`}>{info.enabled ? 'Aktif' : 'Nonaktif'}</span>
            {info.baseUrl ? (
              <>
                <p className="item-title mt-1"><span className="font-mono">{info.model}</span></p>
                <p className="item-sub">{hostOf(info.baseUrl)} · kunci ••••{info.hint} · disimpan {info.updatedLabel}</p>
              </>
            ) : (
              <>
                <p className="item-title mt-1">Groq · kunci ••••{info.hint}</p>
                <p className="item-sub">Pengaturan lama · disimpan {info.updatedLabel}</p>
              </>
            )}
          </div>
          <EnabledToggle on={info.enabled} />
          <ShareDataToggle on={info.shareData} />
          {replacing ? <EndpointForm info={info} onDone={() => setReplacing(false)} /> : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setReplacing(true)}><KeyRound size={16} />Ganti endpoint / kunci</button>
              <ConfirmButton action={deleteAiKey} title="Hapus pengaturan AI?" confirmLabel="Hapus" className="btn btn-secondary is-danger"
                message="Kunci dihapus, Asisten AI nonaktif, dan bot kembali ke mode biasa. Anda bisa mengaturnya lagi kapan saja.">
                <Trash2 size={16} />Hapus
              </ConfirmButton>
            </div>
          )}
        </>
      ) : (
        <EndpointForm />
      )}
    </div>
  )
}

function EndpointForm({ info, onDone }: { info?: AiInfo; onDone?: () => void }) {
  const { onSubmit, pending, errors } = useFormAction(saveAiEndpoint, { onSuccess: () => onDone?.() })
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label="Alamat endpoint" name="ai-base" error={errors.base_url} hint="Alamat HTTPS publik berformat OpenAI, biasanya diakhiri /v1.">
        <input id="ai-base" name="base_url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/v1"
          defaultValue={info?.baseUrl ?? ''} className={`input${errClass(errors, 'base_url')}`} required />
      </Field>
      <Field label="Model" name="ai-model" error={errors.model} hint="Nama model atau combo persis seperti di endpoint Anda.">
        <input id="ai-model" name="model" type="text" autoComplete="off" spellCheck={false} placeholder="nama-model"
          defaultValue={info?.model ?? ''} className={`input${errClass(errors, 'model')}`} required />
      </Field>
      <Field label={info?.baseUrl ? 'Kunci API (tempel lagi)' : 'Kunci API'} name="ai-ekey" error={errors.key} hint="Diuji dengan satu pesan kecil, lalu disimpan terenkripsi.">
        <input id="ai-ekey" name="key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" className={`input${errClass(errors, 'key')}`} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} loadingText="Menguji endpoint…">Simpan & aktifkan</SubmitButton>
        {onDone && <button type="button" className="btn btn-secondary" onClick={onDone}>Batal</button>}
      </div>
    </form>
  )
}

function ShareDataToggle({ on }: { on: boolean }) {
  const { pending, run } = useRunAction()
  return (
    <label className="choice">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => run(() => setAiShareData(e.target.checked))} />
      <span className="min-w-0">
        <span className="choice-title">Izinkan Rupi membaca &amp; mengubah data saya</span>
        <span className="choice-desc">Data dashboard ikut dikirim ke endpoint AI agar Rupi bisa menjawab pertanyaan dan mengusulkan perubahan (tetap dikonfirmasi lewat tombol).</span>
      </span>
    </label>
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
