import 'server-only'

/*
 * Klien Gemini (Google AI Studio) — memakai kunci API milik pengguna sendiri.
 * Kunci tidak pernah dicatat ke log maupun dikirim ke tempat lain selain Google.
 */

/** Alias "terbaru" agar tidak perlu ganti kode saat Google memperbarui model Flash. */
export const GEMINI_MODEL = 'gemini-flash-latest'
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

export type GeminiResult<T> = { ok: true; data: T } | { ok: false; error: string; kind: 'kunci' | 'kuota' | 'jaringan' | 'lain' }

/** Pesan ramah untuk kegagalan umum. */
function explain(status: number, body: string): { error: string; kind: 'kunci' | 'kuota' | 'jaringan' | 'lain' } {
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) return { error: 'Kunci API Gemini tidak valid.', kind: 'kunci' }
  if (status === 401 || status === 403) return { error: 'Kunci API Gemini ditolak (tidak punya akses).', kind: 'kunci' }
  if (status === 429) return { error: 'Kuota Gemini sedang habis. Coba lagi nanti.', kind: 'kuota' }
  if (status >= 500) return { error: 'Layanan Gemini sedang bermasalah.', kind: 'jaringan' }
  return { error: `Gemini menolak permintaan (HTTP ${status}).`, kind: 'lain' }
}

async function generate(key: string, body: Record<string, unknown>, timeoutMs: number): Promise<GeminiResult<string>> {
  try {
    const res = await fetch(ENDPOINT(GEMINI_MODEL), {
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
  }, opts.timeoutMs ?? 15000)
  if (!r.ok) return r
  try { return { ok: true, data: JSON.parse(r.data) as T } } catch { return { ok: false, error: 'Jawaban Gemini tidak terbaca.', kind: 'lain' } }
}

/** Uji kunci dengan permintaan sangat kecil. */
export async function testGeminiKey(key: string): Promise<GeminiResult<true>> {
  const r = await generate(key, { contents: [{ role: 'user', parts: [{ text: 'Balas satu kata: ok' }] }] }, 15000)
  // Jawaban kosong tetap berarti kuncinya diterima.
  return r.ok || (r.kind === 'lain' && /tidak memberi jawaban/.test(r.error)) ? { ok: true, data: true } : r
}
