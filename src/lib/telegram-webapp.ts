import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifikasi initData Telegram Mini App (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * secret = HMAC_SHA256(key "WebAppData", token bot); hash = HMAC_SHA256(key secret, data-check-string).
 * Data-check-string: semua field kecuali `hash`, diurutkan, digabung "key=value" per baris.
 */
export function verifyInitData(initData: string, maxAgeSec = 24 * 3600): { telegramUserId: number } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !initData || initData.length > 4096) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null
  const check = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const expected = createHmac('sha256', secret).update(check).digest()
  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as { id?: number } | null
    return user?.id ? { telegramUserId: user.id } : null
  } catch {
    return null
  }
}
