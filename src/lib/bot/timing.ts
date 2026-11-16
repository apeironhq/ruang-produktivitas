import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/*
 * Konteks per request webhook:
 *  - marks: durasi per langkah → header Server-Timing (diagnosis kecepatan),
 *  - reply: satu panggilan Bot API yang dikirim sebagai BALASAN webhook. Telegram menjalankannya
 *    sendiri setelah menerima respons, sehingga server tidak perlu bolak-balik ke api.telegram.org
 *    (±0,6 dtk dari Mumbai). Hasilnya tidak diketahui → hanya untuk aksi tanpa ketergantungan.
 */
interface Req { marks: Array<[string, number]>; reply?: Record<string, unknown> }
const store = new AsyncLocalStorage<Req>()

export const runTimed = <T>(fn: () => Promise<T>) => store.run({ marks: [] }, fn)

export async function timed<T>(name: string, work: PromiseLike<T>): Promise<T> {
  const t = performance.now()
  try { return await work } finally { store.getStore()?.marks.push([name, performance.now() - t]) }
}

export function serverTiming(totalMs: number) {
  const marks = store.getStore()?.marks ?? []
  return [...marks.map(([n, d], i) => `${n.replace(/[^\w.-]/g, '_')}${i};dur=${d.toFixed(0)}`), `total;dur=${totalMs.toFixed(0)}`].join(', ')
}

/** Titipkan satu panggilan Bot API sebagai balasan webhook. false bila tidak bisa (di luar webhook / sudah terisi). */
export function setWebhookReply(method: string, params: Record<string, unknown>): boolean {
  const s = store.getStore()
  if (!s || s.reply) return false
  s.reply = { method, ...params }
  s.marks.push([`reply.${method}`, 0])
  return true
}
export const takeWebhookReply = () => store.getStore()?.reply
