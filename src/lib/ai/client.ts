import 'server-only'
import { publicEndpointError } from './endpoint'

/*
 * Klien AI berformat OpenAI — memakai kunci milik pengguna sendiri.
 *  - Groq (bawaan): model dipilih otomatis dari daftar model kunci tsb.
 *  - Endpoint kustom (mis. 9router): alamat HTTPS publik + nama model / combo dari pengguna.
 * Kunci tidak pernah dicatat ke log maupun dikirim ke tempat lain selain penyedia yang dipilih.
 */

export interface AiConfig { key: string; baseUrl?: string; model?: string }
export type AiErrorKind = 'kunci' | 'kuota' | 'jaringan' | 'lain'
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string; kind: AiErrorKind }

const GROQ_BASE = 'https://api.groq.com/openai/v1'
/** Urutan model Groq yang dipilih; dicocokkan dengan daftar model yang tersedia untuk kunci tsb. */
const PREFERRED = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']
/** Model non-chat yang tidak boleh terpilih. */
const NOT_CHAT = /whisper|tts|guard|playai|orpheus|distil|prompt-guard|compound/i

const isCustom = (cfg: AiConfig) => !!cfg.baseUrl
/** Nama penyedia untuk pesan: "Groq" atau host endpoint (mis. "9router-anda.vercel.app"). */
export function providerName(cfg: Pick<AiConfig, 'baseUrl'>): string {
  if (!cfg.baseUrl) return 'Groq'
  try { return new URL(cfg.baseUrl).hostname } catch { return 'endpoint AI' }
}

/** Pesan ramah + alasan asli dari penyedia (tidak pernah memuat kunci). */
function explain(name: string, status: number, body: string): { error: string; kind: AiErrorKind } {
  let reason = ''
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    reason = String((typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? '')
  } catch { reason = '' }
  const why = reason ? ` (${reason.replace(/\s+/g, ' ').slice(0, 140)})` : ` (HTTP ${status})`
  if (status === 401) return { error: `Kunci API ${name} tidak valid.`, kind: 'kunci' }
  if (status === 403) return { error: `Kunci API ${name} ditolak.${why}`, kind: 'kunci' }
  if (status === 429) return { error: `Batas pemakaian ${name} sedang tercapai. Coba lagi sebentar lagi.`, kind: 'kuota' }
  if (status >= 500) return { error: `Layanan ${name} sedang bermasalah.${why}`, kind: 'jaringan' }
  return { error: `${name} menolak permintaan.${why}`, kind: 'lain' }
}

async function request(cfg: AiConfig, path: string, init: { body?: Record<string, unknown>; timeoutMs: number }): Promise<AiResult<unknown>> {
  const name = providerName(cfg)
  if (isCustom(cfg)) {
    // Dicek ulang setiap panggilan: domain bisa saja diarahkan ulang setelah disimpan.
    const bad = await publicEndpointError(cfg.baseUrl!)
    if (bad) return { ok: false, error: bad, kind: 'lain' }
  }
  try {
    const res = await fetch(`${cfg.baseUrl ?? GROQ_BASE}${path}`, {
      method: init.body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${cfg.key}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: 'no-store',
      // Endpoint kustom tidak boleh mengalihkan ke alamat lain (bisa ke jaringan internal).
      redirect: isCustom(cfg) ? 'error' : 'follow',
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, ...explain(name, res.status, text) }
    try { return { ok: true, data: JSON.parse(text) as unknown } } catch { return { ok: false, error: `Jawaban ${name} bukan JSON — periksa alamat (biasanya diakhiri /v1).`, kind: 'lain' } }
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message)
    return { ok: false, error: timeout ? `${name} terlalu lama menjawab.` : `Tidak bisa menghubungi ${name}.`, kind: 'jaringan' }
  }
}

/* Model Groq terpilih disimpan sementara (per instance server) agar tidak perlu meminta daftar model setiap pesan. */
let cached: { key: string; model: string; at: number } | null = null

async function pickModel(cfg: AiConfig): Promise<AiResult<string>> {
  if (isCustom(cfg)) return cfg.model ? { ok: true, data: cfg.model } : { ok: false, error: 'Nama model belum diatur.', kind: 'lain' }
  if (cached && cached.key === cfg.key && Date.now() - cached.at < 3_600_000) return { ok: true, data: cached.model }
  const r = await request(cfg, '/models', { timeoutMs: 8000 })
  if (!r.ok) return r
  const ids = ((r.data as { data?: Array<{ id?: string; active?: boolean }> }).data ?? [])
    .filter((m) => m.id && m.active !== false).map((m) => m.id!)
  const model = PREFERRED.find((p) => ids.includes(p)) ?? ids.find((id) => !NOT_CHAT.test(id))
  if (!model) return { ok: false, error: 'Tidak ada model Groq yang bisa dipakai.', kind: 'lain' }
  cached = { key: cfg.key, model, at: Date.now() }
  return { ok: true, data: model }
}

/** Ambil objek JSON dari jawaban model — sebagian model membungkusnya dengan ```json atau teks lain. */
export function parseJsonObject(content: string): unknown | undefined {
  const s = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(s) } catch { /* cari objek di dalam teks */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch { return undefined } }
  return undefined
}

/** Jawaban berupa objek JSON (format dijelaskan di `system`). */
export async function aiJson<T>(cfg: AiConfig, opts: { system: string; prompt: string; timeoutMs?: number }): Promise<AiResult<T>> {
  const name = providerName(cfg)
  let jsonMode = true
  for (let attempt = 0; attempt < 2; attempt++) {
    const m = await pickModel(cfg)
    if (!m.ok) return m
    const r = await request(cfg, '/chat/completions', {
      // Endpoint kustom bisa berpindah-pindah model (combo / fallback) → beri waktu lebih.
      timeoutMs: opts.timeoutMs ?? (isCustom(cfg) ? 45000 : 20000),
      body: {
        model: m.data,
        messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.prompt }],
        temperature: 0.1,
        ...(isCustom(cfg) ? { max_tokens: 1200 } : { max_completion_tokens: 1200 }),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
      },
    })
    if (!r.ok) {
      // Penyedia tidak mendukung mode JSON → ulangi sekali tanpa (prompt tetap meminta JSON).
      if (attempt === 0 && jsonMode && r.kind === 'lain' && /response_format|json_object|json mode/i.test(r.error)) { jsonMode = false; continue }
      // Model Groq sudah dihentikan / tidak ditemukan → pilih ulang sekali.
      if (attempt === 0 && !isCustom(cfg) && r.kind === 'lain' && /model|decommission|not found/i.test(r.error)) { cached = null; continue }
      return r
    }
    const content = (r.data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? ''
    const data = parseJsonObject(content)
    return data && typeof data === 'object' ? { ok: true, data: data as T } : { ok: false, error: `Jawaban ${name} tidak terbaca.`, kind: 'lain' }
  }
  return { ok: false, error: `${name} menolak permintaan.`, kind: 'lain' }
}

/** Uji kunci Groq: cukup minta daftar model (cepat, tidak memakai kuota token). */
export async function testAiKey(key: string): Promise<AiResult<true>> {
  const r = await request({ key }, '/models', { timeoutMs: 10000 })
  return r.ok ? { ok: true, data: true } : r
}

/**
 * Uji endpoint kustom: kunci diterima (daftar model) lalu satu permintaan chat kecil ke
 * model / combo yang dipilih — memastikan nama model benar dan ada penyedia yang aktif.
 */
export async function testAiEndpoint(cfg: Required<AiConfig>): Promise<AiResult<{ reply: string }>> {
  const list = await request(cfg, '/models', { timeoutMs: 15000 })
  if (!list.ok) return list
  const r = await request(cfg, '/chat/completions', {
    timeoutMs: 45000,
    body: { model: cfg.model, messages: [{ role: 'user', content: 'Balas satu kata: siap' }], max_tokens: 8, temperature: 0, stream: false },
  })
  if (!r.ok) return r
  const reply = String((r.data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '').trim()
  return { ok: true, data: { reply: reply.slice(0, 40) } }
}
