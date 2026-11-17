import 'server-only'

/*
 * Klien Gemini (Google AI Studio) — memakai kunci API milik pengguna sendiri.
 * Kunci tidak pernah dicatat ke log maupun dikirim ke tempat lain selain Google.
 */

/**
 * Alias "terbaru" agar tidak perlu ganti kode saat Google memperbarui model.
 * Flash-Lite dipilih karena cepat (tanpa "berpikir" panjang) — cukup untuk memahami pesan & menyusun JSON.
 */
export const GEMINI_MODEL = 'gemini-flash-lite-latest'
/** Vertex AI (mode express) tidak mengenal alias "latest". */
const VERTEX_MODEL = 'gemini-2.5-flash'
const ENDPOINTS = {
  studio: { url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, header: true },
  vertex: { url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${VERTEX_MODEL}:generateContent`, header: true },
} as const

export type GeminiResult<T> = { ok: true; data: T } | { ok: false; error: string; kind: 'kunci' | 'kuota' | 'jaringan' | 'lain' }

/** Pesan ramah untuk kegagalan umum. */
function explain(status: number, body: string): { error: string; kind: 'kunci' | 'kuota' | 'jaringan' | 'lain' } {
  if (status === 400 && /API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|invalid authentication/i.test(body)) return { error: 'Kunci API Gemini tidak valid.', kind: 'kunci' }
  if (status === 401 || status === 403) return { error: 'Kunci API Gemini ditolak (tidak punya akses).', kind: 'kunci' }
  if (status === 429) return { error: 'Kuota Gemini sedang habis. Coba lagi nanti.', kind: 'kuota' }
  if (status >= 500) return { error: 'Layanan Gemini sedang bermasalah.', kind: 'jaringan' }
  return { error: `Gemini menolak permintaan (HTTP ${status}).`, kind: 'lain' }
}

/** Kunci format baru ("AQ.…") dicoba juga ke Vertex AI bila Gemini API menolaknya. */
async function generate(key: string, body: Record<string, unknown>, timeoutMs: number): Promise<GeminiResult<string>> {
  const first = await generateAt('studio', key, body, timeoutMs)
  if (first.ok || first.kind !== 'kunci' || !key.startsWith('AQ.')) return first
  const second = await generateAt('vertex', key, body, timeoutMs)
  return second.ok || second.kind !== 'kunci' ? second : first
}

async function generateAt(where: keyof typeof ENDPOINTS, key: string, body: Record<string, unknown>, timeoutMs: number): Promise<GeminiResult<string>> {
  try {
    const res = await fetch(ENDPOINTS[where].url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, ...explain(res.status, text) }
    const json = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const out = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    return out ? { ok: true, data: out } : { ok: false, error: 'Gemini tidak memberi jawaban.', kind: 'lain' }
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message)
    return { ok: false, error: timeout ? 'Gemini terlalu lama menjawab.' : 'Tidak bisa menghubungi Gemini.', kind: 'jaringan' }
  }
}

/** Jawaban terstruktur (JSON sesuai `schema`). */
export async function geminiJson<T>(key: string, opts: { system: string; prompt: string; schema: Record<string, unknown>; timeoutMs?: number }): Promise<GeminiResult<T>> {
  const r = await generate(key, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: opts.schema, temperature: 0.1 },
  }, opts.timeoutMs ?? 20000)
  if (!r.ok) return r
  try { return { ok: true, data: JSON.parse(r.data) as T } } catch { return { ok: false, error: 'Jawaban Gemini tidak terbaca.', kind: 'lain' } }
}

/**
 * Uji kunci tanpa menyuruh model menjawab: cukup baca info model (cepat, tidak memakai kuota token).
 * Kunci format baru ("AQ.…") yang ditolak Gemini API dicoba ke Vertex AI dengan permintaan sangat kecil.
 */
export async function testGeminiKey(key: string): Promise<GeminiResult<true>> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`, {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000), cache: 'no-store',
    })
    if (res.ok) return { ok: true, data: true }
    const e = explain(res.status, await res.text())
    if (e.kind !== 'kunci' || !key.startsWith('AQ.')) return { ok: false, ...e }
  } catch {
    return { ok: false, error: 'Tidak bisa menghubungi Gemini. Coba lagi.', kind: 'jaringan' }
  }
  const v = await generateAt('vertex', key, { contents: [{ role: 'user', parts: [{ text: 'ok' }] }] }, 20000)
  return v.ok || (v.kind === 'lain' && /tidak memberi jawaban/.test(v.error)) ? { ok: true, data: true } : v
}
