'use client'

import { ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmButton, useRunAction } from '@/components/ui/actions'
import { Field, SubmitButton, errClass, useFormAction } from '@/components/ui/forms'
import { deleteAiKey, saveAiEndpoint, saveAiKey, setAiEnabled } from './ai-actions'

export interface AiInfo { enabled: boolean; hint: string; baseUrl: string; model: string; updatedLabel: string }
type Provider = 'groq' | 'kustom'

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
                <p className="item-title mt-1">{hostOf(info.baseUrl)} · <span className="font-mono">{info.model}</span></p>
                <p className="item-sub">Endpoint kustom · kunci ••••{info.hint} · disimpan {info.updatedLabel}</p>
              </>
            ) : (
              <>
                <p className="item-title mt-1">Groq · kunci ••••{info.hint}</p>
                <p className="item-sub">Disimpan {info.updatedLabel} · terenkripsi, tidak bisa dilihat lagi</p>
              </>
            )}
          </div>
          <EnabledToggle on={info.enabled} />
          {replacing ? <ProviderForms initial={info.baseUrl ? 'kustom' : 'groq'} info={info} onDone={() => setReplacing(false)} /> : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setReplacing(true)}><KeyRound size={16} />Ganti penyedia / kunci</button>
              <ConfirmButton action={deleteAiKey} title="Hapus pengaturan AI?" confirmLabel="Hapus" className="btn btn-secondary is-danger"
                message="Kunci dihapus, Asisten AI nonaktif, dan bot kembali ke mode biasa. Anda bisa mengaturnya lagi kapan saja.">
                <Trash2 size={16} />Hapus
              </ConfirmButton>
            </div>
          )}
        </>
      ) : (
        <ProviderForms initial="groq" />
      )}
    </div>
  )
}

/** Pilihan penyedia + formulirnya. */
function ProviderForms({ initial, info, onDone }: { initial: Provider; info?: AiInfo; onDone?: () => void }) {
  const [provider, setProvider] = useState<Provider>(initial)
  return (
    <div className="flex flex-col gap-4">
      <div className="seg" role="group" aria-label="Penyedia AI">
        <button type="button" className={provider === 'groq' ? 'on' : ''} aria-pressed={provider === 'groq'} onClick={() => setProvider('groq')}>Groq</button>
        <button type="button" className={provider === 'kustom' ? 'on' : ''} aria-pressed={provider === 'kustom'} onClick={() => setProvider('kustom')}>Endpoint kustom (9router)</button>
      </div>
      {provider === 'groq' ? (
        <>
          <ol className="steps-list">
            <li>Buka <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="link">console.groq.com <ExternalLink size={12} className="inline" /></a> lalu daftar / masuk (gratis — bisa pakai akun Google).</li>
            <li>Tekan <strong>Create API Key</strong>, beri nama (mis. <em>Rupi</em>), lalu salin kuncinya — hanya ditampilkan sekali.</li>
            <li>Tempel di bawah — Rupi mengujinya dulu sebelum menyimpan.</li>
          </ol>
          <KeyForm label={info ? 'Kunci API Groq baru' : 'Kunci API Groq'} onDone={onDone} />
        </>
      ) : (
        <>
          <ol className="steps-list">
            <li>Di dashboard 9router (atau endpoint lain berformat OpenAI), salin alamat <strong>API Endpoint</strong> — biasanya diakhiri <code>/v1</code>.</li>
            <li>Buat <strong>API Key</strong> di sana, lalu tulis nama <strong>model</strong> atau <strong>combo</strong> yang dipakai (combo = otomatis pindah model bila satu kena limit).</li>
            <li>Tempel di bawah — Rupi mengirim satu pesan uji kecil sebelum menyimpan.</li>
          </ol>
          <EndpointForm info={info} onDone={onDone} />
        </>
      )}
    </div>
  )
}

function KeyForm({ label, onDone }: { label: string; onDone?: () => void }) {
  const { onSubmit, pending, errors } = useFormAction(saveAiKey, { onSuccess: () => onDone?.() })
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label={label} name="ai-key" error={errors.key} hint="Diawali “gsk_”. Kunci hanya dikirim ke Groq untuk diuji, lalu disimpan terenkripsi.">
        <input id="ai-key" name="key" type="password" autoComplete="off" spellCheck={false} placeholder="gsk_…" className={`input${errClass(errors, 'key')}`} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} loadingText="Menguji kunci…">Simpan & aktifkan</SubmitButton>
        {onDone && <button type="button" className="btn btn-secondary" onClick={onDone}>Batal</button>}
      </div>
    </form>
  )
}

function EndpointForm({ info, onDone }: { info?: AiInfo; onDone?: () => void }) {
  const { onSubmit, pending, errors } = useFormAction(saveAiEndpoint, { onSuccess: () => onDone?.() })
  return (
    <form onSubmit={onSubmit} className="form-stack" noValidate>
      <Field label="Alamat endpoint" name="ai-base" error={errors.base_url} hint="Harus HTTPS dan bisa diakses publik, mis. https://nama-anda.vercel.app/v1">
        <input id="ai-base" name="base_url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/v1"
          defaultValue={info?.baseUrl ?? ''} className={`input${errClass(errors, 'base_url')}`} required />
      </Field>
      <Field label="Model atau combo" name="ai-model" error={errors.model} hint="Persis seperti di dashboard endpoint, mis. nama combo Anda atau groq/llama-3.3-70b-versatile.">
        <input id="ai-model" name="model" type="text" autoComplete="off" spellCheck={false} placeholder="nama-combo"
          defaultValue={info?.model ?? ''} className={`input${errClass(errors, 'model')}`} required />
      </Field>
      <Field label={info?.baseUrl ? 'Kunci API (tempel lagi)' : 'Kunci API'} name="ai-ekey" error={errors.key} hint="Kunci hanya dikirim ke alamat di atas untuk diuji, lalu disimpan terenkripsi.">
        <input id="ai-ekey" name="key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" className={`input${errClass(errors, 'key')}`} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} loadingText="Menguji endpoint…">Simpan & aktifkan</SubmitButton>
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
