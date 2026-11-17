import 'server-only'

/*
 * Klien Groq (groq.com, API kompatibel OpenAI) — memakai kunci API milik pengguna sendiri.
 * Kunci tidak pernah dicatat ke log maupun dikirim ke tempat lain selain Groq.
 */

const BASE = 'https://api.groq.com/openai/v1'
/** Urutan model yang dipilih; dicocokkan dengan daftar model yang tersedia untuk kunci tsb. */
const PREFERRED = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']
/** Model non-chat yang tidak boleh terpilih. */
const NOT_CHAT = /whisper|tts|guard|playai|orpheus|distil|prompt-guard|compound/i

export type AiErrorKind = 'kunci' | 'kuota' | 'jaringan' | 'lain'
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string; kind: AiErrorKind }

/** Pesan ramah + alasan asli dari Groq (tidak pernah memuat kunci). */
function explain(status: number, body: string): { error: string; kind: AiErrorKind } {
  let reason = ''
  try { reason = String((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '') } catch { reason = '' }
  const why = reason ? ` (${reason.replace(/\s+/g, ' ').slice(0, 140)})` : ` (HTTP ${status})`
  if (status === 401) return { error: 'Kunci API Groq tidak valid.', kind: 'kunci' }
  if (status === 403) return { error: `Kunci API Groq ditolak.${why}`, kind: 'kunci' }
  if (status === 429) return { error: 'Batas pemakaian Groq sedang tercapai. Coba lagi sebentar lagi.', kind: 'kuota' }
  if (status >= 500) return { error: `Layanan Groq sedang bermasalah.${why}`, kind: 'jaringan' }
  return { error: `Groq menolak permintaan.${why}`, kind: 'lain' }
}

async function request(key: string, path: string, init: { body?: Record<string, unknown>; timeoutMs: number }): Promise<AiResult<unknown>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init.body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${key}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, ...explain(res.status, text) }
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message)
    return { ok: false, error: timeout ? 'Groq terlalu lama menjawab.' : 'Tidak bisa menghubungi Groq.', kind: 'jaringan' }
  }
}

/* Model terpilih disimpan sementara (per instance server) agar tidak perlu meminta daftar model setiap pesan. */
let cached: { model: string; at: number } | null = null

async function pickModel(key: string): Promise<AiResult<string>> {
  if (cached && Date.now() - cached.at < 3_600_000) return { ok: true, data: cached.model }
  const r = await request(key, '/models', { timeoutMs: 8000 })
  if (!r.ok) return r
  const ids = ((r.data as { data?: Array<{ id?: string; active?: boolean }> }).data ?? [])
    .filter((m) => m.id && m.active !== false).map((m) => m.id!)
  const model = PREFERRED.find((p) => ids.includes(p)) ?? ids.find((id) => !NOT_CHAT.test(id))
  if (!model) return { ok: false, error: 'Tidak ada model Groq yang bisa dipakai.', kind: 'lain' }
  cached = { model, at: Date.now() }
  return { ok: true, data: model }
}

/** Jawaban berupa objek JSON (format dijelaskan di `system`). */
export async function aiJson<T>(key: string, opts: { system: string; prompt: string; timeoutMs?: number }): Promise<AiResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const m = await pickModel(key)
    if (!m.ok) return m
    const r = await request(key, '/chat/completions', {
      timeoutMs: opts.timeoutMs ?? 20000,
      body: {
        model: m.data,
        messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.prompt }],
        temperature: 0.1,
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
      },
    })
    if (!r.ok) {
      // Model sudah dihentikan / tidak ditemukan → pilih ulang sekali.
      if (attempt === 0 && r.kind === 'lain' && /model|decommission|not found/i.test(r.error)) { cached = null; continue }
      return r
    }
    const content = (r.data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? ''
    try { return { ok: true, data: JSON.parse(content) as T } } catch { return { ok: false, error: 'Jawaban Groq tidak terbaca.', kind: 'lain' } }
  }
  return { ok: false, error: 'Groq menolak permintaan.', kind: 'lain' }
}

/** Uji kunci: cukup minta daftar model (cepat, tidak memakai kuota token). */
export async function testAiKey(key: string): Promise<AiResult<true>> {
  const r = await request(key, '/models', { timeoutMs: 10000 })
  return r.ok ? { ok: true, data: true } : r
}
