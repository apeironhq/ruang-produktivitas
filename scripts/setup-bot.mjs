// Menyiapkan pengingat terjadwal & Bot Telegram.
//
//   npm run setup:bot -- --url https://ruang-produktivitas.vercel.app
//
// Langkah:
//  1. Membuat CRON_SECRET & TELEGRAM_WEBHOOK_SECRET acak bila belum ada (ditulis ke .env.local, tidak di-commit).
//  2. Menjadwalkan pg_cron + pg_net di Supabase: POST {url}/api/cron/pengingat setiap 5 menit
//     dengan header Authorization: Bearer CRON_SECRET.
//  3. Bila TELEGRAM_BOT_TOKEN ada: setWebhook (dengan secret_token), setMyCommands, dan
//     menulis TELEGRAM_BOT_USERNAME ke .env.local.
//
// Variabel yang sama (CRON_SECRET, TELEGRAM_*, SUPABASE_SECRET_KEY) juga harus diisi di Vercel.
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import pg from 'pg'

const ENV = '.env.local'
try { process.loadEnvFile(ENV) } catch { /* boleh dari shell */ }

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined }
const url = (arg('url') ?? process.env.PRODUCTION_URL ?? '').replace(/\/$/, '')
if (!/^https:\/\//.test(url)) {
  console.error('Sertakan alamat produksi: npm run setup:bot -- --url https://domain-anda.vercel.app')
  process.exit(1)
}

function ensureEnv(name, make) {
  if (process.env[name]) return process.env[name]
  const value = make()
  const cur = (() => { try { return readFileSync(ENV, 'utf8') } catch { return '' } })()
  appendFileSync(ENV, `${cur.endsWith('\n') || !cur ? '' : '\n'}${name}=${value}\n`)
  process.env[name] = value
  console.log(`+ ${name} dibuat & disimpan di ${ENV}`)
  return value
}

const cronSecret = ensureEnv('CRON_SECRET', () => randomBytes(32).toString('hex'))
const webhookSecret = ensureEnv('TELEGRAM_WEBHOOK_SECRET', () => randomBytes(32).toString('hex'))

/* ---- 2. pg_cron ---- */
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diisi di .env.local.')
  process.exit(1)
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
await db.query('create extension if not exists pg_cron with schema pg_catalog')
await db.query('create extension if not exists pg_net with schema extensions')
await db.query(`select cron.unschedule(jobid) from cron.job where jobname = 'ruang-pengingat'`)
const { rows } = await db.query(
  `select cron.schedule('ruang-pengingat', '*/5 * * * *', format(
     $f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 55000)$f$,
     $1::text, $2::text)) as id`,
  [`${url}/api/cron/pengingat`, `Bearer ${cronSecret}`],
)
console.log(`✓ pg_cron dijadwalkan (job ${rows[0].id}): setiap 5 menit → ${url}/api/cron/pengingat`)
await db.end()

/* ---- 3. Telegram ---- */
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.log('\n• TELEGRAM_BOT_TOKEN belum ada — langkah Telegram dilewati. Buat bot di @BotFather, isi token di .env.local, lalu jalankan lagi.')
  process.exit(0)
}
const tg = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}
const me = await tg('getMe')
await tg('setWebhook', { url: `${url}/api/telegram/webhook`, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true, max_connections: 10 })
await tg('setMyCommands', {
  commands: [
    { command: 'tugas', description: 'Tugas & kegiatan hari ini' },
    { command: 'catat', description: 'Simpan catatan cepat' },
    { command: 'belajar', description: 'Catat sesi belajar (menit bidang materi)' },
    { command: 'target', description: 'Progres target aktif' },
    { command: 'pengingat', description: 'Pengingat 24 jam ke depan' },
    { command: 'bantuan', description: 'Daftar perintah' },
    { command: 'putus', description: 'Putuskan bot dari akun' },
  ],
})
await tg('setMyDescription', { description: 'Asisten Ruang Produktivitas: pengingat tugas, agenda harian, catatan cepat, dan sesi belajar. Tautkan dari Pengaturan di aplikasi.' })
if (process.env.TELEGRAM_BOT_USERNAME !== me.username) ensureEnv('TELEGRAM_BOT_USERNAME', () => me.username)
console.log(`✓ Webhook @${me.username} → ${url}/api/telegram/webhook`)
console.log(`✓ Daftar perintah dipasang`)
console.log('\nPastikan di Vercel → Settings → Environment Variables terisi:')
console.log('  SUPABASE_SECRET_KEY, CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME')
