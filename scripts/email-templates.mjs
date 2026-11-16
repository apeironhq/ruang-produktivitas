// Template email autentikasi Supabase bermerek Ruang Produktivitas.
//
//   npm run email:build                 → tulis HTML ke supabase/templates/ + pratinjau
//   npm run email:apply                 → pasang ke Supabase (butuh SUPABASE_ACCESS_TOKEN di .env.local,
//                                          token pribadi dari supabase.com/dashboard/account/tokens)
//
// Paket gratis Supabase hanya mengizinkan template kustom bila memakai SMTP sendiri. Isi juga di .env.local:
//   SMTP_USER=alamat@gmail.com   SMTP_PASS=<App Password 16 huruf>   (opsional: SMTP_HOST, SMTP_PORT,
//   SMTP_FROM, SMTP_SENDER_NAME — bawaan smtp.gmail.com:465, "Ruang Produktivitas")
//
// Tautan memakai token_hash → diverifikasi oleh /auth/confirm di server, sehingga tetap berhasil
// walau email dibuka di perangkat/browser lain (alur PKCE bawaan butuh browser yang sama).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

try { process.loadEnvFile('.env.local') } catch { /* boleh dari shell */ }
const SITE = 'https://ruang-produktivitas.vercel.app'
const BRAND = '#2563eb'

// Alamat produksi langsung (bukan {{ .SiteURL }}) → tetap benar walau "Site URL" Supabase belum diatur.
const confirmUrl = (type, next) => `${SITE}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}&next=${encodeURIComponent(next)}`

/** Layout tabel (aman untuk Gmail/Outlook): banner, judul, paragraf, tombol, tautan cadangan, catatan, kaki. */
function layout({ preheader, title, intro, button, url, note, code }) {
  const font = "'Ubuntu', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#eef3fb;font-family:${font};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3fb;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dde5f1;">
      <tr><td style="padding:0;line-height:0;">
        <a href="${SITE}" style="text-decoration:none;"><img src="${SITE}/bot/header.jpg" width="560" alt="Rupi — Ruang Produktivitas, asisten produktivitas pribadimu" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></a>
      </td></tr>
      <tr><td style="padding:32px 36px 8px;">
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:500;color:#101828;">${title}</h1>
        ${intro.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#475467;">${p}</p>`).join('\n        ')}
      </td></tr>
      ${code ? `<tr><td align="center" style="padding:8px 36px 20px;">
        <div style="display:inline-block;padding:14px 28px;border-radius:12px;background:#f4f7fc;border:1px dashed #b9c6dc;font-size:28px;letter-spacing:8px;font-weight:500;color:#101828;">${code}</div>
      </td></tr>` : ''}
      ${button ? `<tr><td align="center" style="padding:8px 36px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${BRAND}" style="border-radius:10px;">
            <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:10px;font-family:${font};">${button}</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 36px 20px;">
        <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#667085;">Tombol tidak berfungsi? Salin tautan ini ke browser:</p>
        <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:${BRAND};text-decoration:underline;">${url}</a></p>
      </td></tr>` : ''}
      <tr><td style="padding:0 36px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding:14px 16px;border-radius:10px;background:#f4f7fc;font-size:13px;line-height:1.55;color:#475467;">${note}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;border-top:1px solid #eef2f7;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:500;color:#344054;">Ruang Produktivitas</p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#98a2b3;">Satu ruang untuk mencatat kegiatan, merencanakan tujuan, belajar, dan memantau pencapaian.<br>Email ini dikirim otomatis — mohon tidak membalas.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`
}

const IGNORE = 'Jika kamu tidak merasa melakukan ini, abaikan saja email ini — akunmu tetap aman.'
export const TEMPLATES = {
  confirmation: {
    subject: 'Konfirmasi email kamu — Ruang Produktivitas',
    html: layout({
      preheader: 'Satu langkah lagi untuk mulai memakai Ruang Produktivitas.',
      title: 'Selamat datang di Ruang Produktivitas!',
      intro: ['Terima kasih sudah mendaftar. Konfirmasi alamat email kamu untuk mengaktifkan akun dan mulai mencatat tugas, belajar, keuangan, dan target dalam satu tempat.'],
      button: 'Konfirmasi email',
      url: confirmUrl('email', '/'),
      note: `<strong style="color:#344054;">Tautan berlaku 24 jam</strong> dan hanya bisa dipakai sekali. ${IGNORE}`,
    }),
  },
  recovery: {
    subject: 'Atur ulang password — Ruang Produktivitas',
    html: layout({
      preheader: 'Tautan untuk membuat password baru akun kamu.',
      title: 'Atur ulang password',
      intro: ['Kami menerima permintaan untuk mengatur ulang password akun Ruang Produktivitas yang memakai email ini.', 'Tekan tombol di bawah untuk membuat password baru.'],
      button: 'Buat password baru',
      url: confirmUrl('recovery', '/atur-password'),
      note: `<strong style="color:#344054;">Tautan berlaku 1 jam</strong> dan hanya bisa dipakai sekali. Jika kamu tidak meminta ini, abaikan email ini — password lama tetap berlaku.`,
    }),
  },
  email_change: {
    subject: 'Konfirmasi perubahan email — Ruang Produktivitas',
    html: layout({
      preheader: 'Konfirmasi alamat email baru untuk akun kamu.',
      title: 'Konfirmasi email baru',
      intro: ['Kamu meminta mengganti email akun Ruang Produktivitas dari <strong style="color:#344054;">{{ .Email }}</strong> ke <strong style="color:#344054;">{{ .NewEmail }}</strong>.', 'Tekan tombol di bawah untuk menyelesaikan perubahan.'],
      button: 'Konfirmasi perubahan',
      url: confirmUrl('email_change', '/pengaturan'),
      note: `Jika kamu tidak meminta perubahan ini, abaikan email ini dan segera ganti password akunmu.`,
    }),
  },
  magic_link: {
    subject: 'Tautan masuk — Ruang Produktivitas',
    html: layout({
      preheader: 'Masuk ke Ruang Produktivitas tanpa password.',
      title: 'Tautan masuk kamu',
      intro: ['Tekan tombol di bawah untuk masuk ke akun Ruang Produktivitas kamu.'],
      button: 'Masuk sekarang',
      url: confirmUrl('email', '/'),
      note: `<strong style="color:#344054;">Tautan berlaku 1 jam</strong> dan hanya bisa dipakai sekali. ${IGNORE}`,
    }),
  },
  invite: {
    subject: 'Kamu diundang ke Ruang Produktivitas',
    html: layout({
      preheader: 'Terima undangan dan buat password akunmu.',
      title: 'Kamu diundang!',
      intro: ['Kamu diundang untuk memakai Ruang Produktivitas. Terima undangan lalu buat password untuk akunmu.'],
      button: 'Terima undangan',
      url: confirmUrl('invite', '/atur-password'),
      note: IGNORE,
    }),
  },
  reauthentication: {
    subject: 'Kode verifikasi — Ruang Produktivitas',
    html: layout({
      preheader: 'Kode verifikasi untuk melanjutkan.',
      title: 'Kode verifikasi',
      intro: ['Masukkan kode berikut untuk melanjutkan tindakan di akun Ruang Produktivitas kamu.'],
      code: '{{ .Token }}',
      note: `Kode berlaku beberapa menit. ${IGNORE}`,
    }),
  },
}

/* ---------- build ---------- */
const dir = join('supabase', 'templates')
mkdirSync(dir, { recursive: true })
for (const [name, t] of Object.entries(TEMPLATES)) writeFileSync(join(dir, `${name}.html`), t.html)
// Pratinjau dengan contoh nilai (untuk dicek di browser).
const sample = (h) => h.replaceAll('{{ .SiteURL }}', SITE).replaceAll('{{ .TokenHash }}', 'contoh').replaceAll('{{ .Token }}', '483920')
  .replaceAll('{{ .Email }}', 'lama@contoh.id').replaceAll('{{ .NewEmail }}', 'baru@contoh.id')
writeFileSync(join(dir, '_pratinjau.html'), `<!doctype html><meta charset="utf-8"><title>Pratinjau email</title><body style="margin:0;background:#dfe6f1">${Object.entries(TEMPLATES).map(([n, t]) => `<h2 style="font:500 15px system-ui;margin:24px;color:#344054">${n} — “${t.subject}”</h2><iframe srcdoc="${sample(t.html).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" style="width:100%;height:900px;border:0"></iframe>`).join('')}</body>`)
console.log(`✓ ${Object.keys(TEMPLATES).length} template ditulis ke ${dir}/ (pratinjau: ${dir}/_pratinjau.html)`)

/* ---------- apply ---------- */
if (process.argv.includes('--apply')) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!token || !ref) {
    console.error('Butuh SUPABASE_ACCESS_TOKEN (token pribadi Supabase) di .env.local dan NEXT_PUBLIC_SUPABASE_URL.')
    process.exit(1)
  }
  const body = {}
  // SMTP sendiri (wajib di paket gratis agar template bisa diubah). Gmail: App Password, port 465.
  const smtpUser = process.env.SMTP_USER, smtpPass = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '')
  if (smtpUser && smtpPass) {
    Object.assign(body, {
      smtp_host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      smtp_port: process.env.SMTP_PORT ?? '465',
      smtp_user: smtpUser,
      smtp_pass: smtpPass,
      smtp_admin_email: process.env.SMTP_FROM ?? smtpUser,
      smtp_sender_name: process.env.SMTP_SENDER_NAME ?? 'Ruang Produktivitas',
      rate_limit_email_sent: 100, // email per jam (bawaan Supabase dengan SMTP sendiri: 30)
    })
    console.log(`• SMTP: ${body.smtp_host}:${body.smtp_port} sebagai "${body.smtp_sender_name}" <${body.smtp_admin_email}>`)
  }
  for (const [name, t] of Object.entries(TEMPLATES)) {
    body[`mailer_subjects_${name}`] = t.subject
    body[`mailer_templates_${name}_content`] = t.html
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) { console.error('Gagal memasang template:', res.status, (await res.text()).slice(0, 300)); process.exit(1) }
  console.log('✓ Template & subjek email terpasang di Supabase')
}
