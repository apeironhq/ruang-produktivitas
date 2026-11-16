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
  `select cron.schedule('ruang-pengingat', '* * * * *', format(
     $f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 55000)$f$,
     $1::text, $2::text)) as id`,
  [`${url}/api/cron/pengingat`, `Bearer ${cronSecret}`],
)
console.log(`✓ pg_cron dijadwalkan (job ${rows[0].id}): setiap menit → ${url}/api/cron/pengingat`)
// Ping ringan ke webhook setiap 2 menit agar fungsinya tetap hangat (tombol bot tanpa cold start).
await db.query(`select cron.unschedule(jobid) from cron.job where jobname = 'ruang-bot-hangat'`)
await db.query(
  `select cron.schedule('ruang-bot-hangat', '*/2 * * * *', format($f$select net.http_get(url := %L, timeout_milliseconds := 10000)$f$, $1::text))`,
  [`${url}/api/telegram/webhook`],
)
console.log(`✓ pg_cron: ping hangat setiap 2 menit → ${url}/api/telegram/webhook`)
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
    { command: 'menu', description: '🏠 Ringkasan hari ini & menu utama' },
    { command: 'tugas', description: '✅ Tugas & kegiatan' },
    { command: 'tambah', description: '➕ Tambah tugas (judul besok 09.00)' },
    { command: 'kegiatan', description: '📅 Jadwalkan kegiatan' },
    { command: 'catat', description: '🗒 Catatan / jurnal' },
    { command: 'keluar', description: '💸 Catat pengeluaran (25rb makan)' },
    { command: 'masuk', description: '💵 Catat pemasukan' },
    { command: 'belajar', description: '📚 Catat sesi belajar' },
    { command: 'timer', description: '⏱ Timer, mis. /timer 25 fokus' },
    { command: 'ingatkan', description: '🔔 Ingatkan saya, mis. /ingatkan 30m minum obat' },
    { command: 'sore', description: '🌙 Tugas hari ini yang belum selesai' },
    { command: 'kalender', description: '📅 Agenda 7 hari' },
    { command: 'target', description: '🎯 Progres target' },
    { command: 'keuangan', description: '💰 Ringkasan keuangan' },
    { command: 'kebiasaan', description: '🔁 Check-in kebiasaan' },
    { command: 'ringkasan', description: '📊 Perkembangan 7 hari' },
    { command: 'pengaturan', description: '⚙️ Jam ringkasan & akun' },
    { command: 'bantuan', description: '📖 Daftar perintah' },
    { command: 'batal', description: '✖️ Batalkan isian' },
  ],
})
// Tombol Menu biru di chat menampilkan daftar perintah.
await tg('setChatMenuButton', { menu_button: { type: 'commands' } })
await tg('setMyDescription', { description: 'Rupi — asisten produktivitas pribadimu: tugas & pengingat, agenda harian, keuangan, belajar, jurnal, target, dan kebiasaan. Tautkan dari Pengaturan di Ruang Produktivitas.' })
await tg('setMyShortDescription', { short_description: 'Asisten produktivitas pribadimu 🐰' })
if (process.env.TELEGRAM_BOT_USERNAME !== me.username) ensureEnv('TELEGRAM_BOT_USERNAME', () => me.username)
console.log(`✓ Webhook @${me.username} → ${url}/api/telegram/webhook`)
console.log(`✓ Daftar perintah dipasang`)
console.log(`✓ Tombol Menu → daftar perintah`)
console.log('\nPastikan di Vercel → Settings → Environment Variables terisi:')
console.log('  SUPABASE_SECRET_KEY, CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME')
