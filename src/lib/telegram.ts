import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/** Bot Telegram (BT-01 … BT-09). Token & rahasia hanya dari environment server. */
export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN
export const botUsername = () => (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '')

/** Escape untuk parse_mode HTML. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface InlineButton { text: string; callback_data: string }

type CallResult<T> = { ok: true; result: T } | { ok: false; error: string; retryable: boolean }

async function call<T = unknown>(method: string, body: Record<string, unknown> | FormData): Promise<CallResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum diatur', retryable: false }
  const form = body instanceof FormData
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      ...(form ? {} : { headers: { 'content-type': 'application/json' } }),
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(form ? 15000 : 8000),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (res.ok && json?.ok) return { ok: true, result: json.result as T }
    // 403: pengguna memblokir bot / chat tidak ada → tidak perlu dicoba ulang
    return { ok: false, error: (json?.description ?? `HTTP ${res.status}`).slice(0, 300), retryable: res.status === 429 || res.status >= 500 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Jaringan gagal', retryable: true }
  }
}

export function sendMessage(chatId: number | string, html: string, buttons?: InlineButton[][]) {
  return call('sendMessage', {
    chat_id: chatId,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })
}

export type Keyboard = Array<Array<InlineButton | { text: string; url: string }>>

/** Kirim gambar (PNG di memori) + keterangan + tombol inline. */
export function sendPhoto(chatId: number | string, png: Buffer, caption: string, keyboard?: Keyboard) {
  const fd = new FormData()
  fd.set('chat_id', String(chatId))
  fd.set('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ringkasan.png')
  fd.set('caption', caption.slice(0, 1024))
  fd.set('parse_mode', 'HTML')
  if (keyboard) fd.set('reply_markup', JSON.stringify({ inline_keyboard: keyboard }))
  return call('sendPhoto', fd)
}

export function sendMessageKb(chatId: number | string, html: string, keyboard: Keyboard) {
  return call('sendMessage', { chat_id: chatId, text: html.slice(0, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: keyboard } })
}

export function editMessage(chatId: number | string, messageId: number, html: string) {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text: html.slice(0, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
}

export function answerCallback(id: string, text?: string) {
  return call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })
}

/** Perbandingan rahasia waktu-konstan. */
export function secretMatches(given: string | null | undefined, expected: string | undefined) {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const BOT_COMMANDS = [
  { command: 'menu', description: 'Ringkasan hari ini & menu utama' },
  { command: 'tugas', description: 'Tugas & kegiatan hari ini' },
  { command: 'tambah', description: 'Tambah tugas: /tambah judul besok 09.00' },
  { command: 'catat', description: 'Simpan catatan cepat: /catat isi catatan' },
  { command: 'belajar', description: 'Catat sesi belajar: /belajar 45 Next.js materi' },
  { command: 'target', description: 'Progres target aktif' },
  { command: 'pengingat', description: 'Pengingat 24 jam ke depan' },
  { command: 'bantuan', description: 'Daftar perintah' },
  { command: 'putus', description: 'Putuskan bot dari akun' },
]
