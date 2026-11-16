# Ruang Produktivitas

Satu ruang untuk mencatat kegiatan, belajar, merencanakan target, dan memantau pencapaian.
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Auth, Postgres + RLS) · Vercel.

Sistem desain (token warna, font Ubuntu 400/500, radius, sidebar, topbar, menu bawah ponsel,
modal, toast, KPI, grafik) di-port 1:1 dari MDUNDIG — lihat `src/app/globals.css`.

## Fitur Tahap 1 (P0)

| Menu | Isi |
|---|---|
| Beranda | KPI 7 hari (tugas selesai, waktu belajar, target aktif, catatan) + sparkline, grafik aktivitas belajar, donut status tugas, agenda hari ini, target aktif, aktivitas terbaru, tombol cepat |
| Tugas & Kegiatan | Tugas (tenggat, prioritas, 5 status, subtugas/daftar periksa) & Kegiatan (jadwal mulai–selesai, lokasi); tampilan Daftar & Papan; saringan Aktif/Hari ini/Terlambat/Selesai, jenis, prioritas, pencarian |
| Kalender | Grid bulanan: tenggat tugas, kegiatan, tenggat target; agenda bulan ini |
| Target Saya | Satuan rupiah/jumlah/durasi/persentase/biner, arah naik/turun, sumber progres manual/modul/tugas, tahapan, riwayat kontribusi, otomatis tercapai (dicatat sekali), arsip |
| Ruang Belajar | Bidang, sumber (posisi terakhir), modul (selesai/lewati/urutkan), sesi belajar (durasi, ringkasan, kendala, langkah berikutnya), riwayat & total durasi per rentang |
| Catatan & Jurnal | Satu editor untuk catatan, jurnal harian (suasana hati), belajar, trading (instrumen, harga, hasil, evaluasi), pekerjaan, ide, khusus; tag, tautan target/bidang, arsip, pencarian, saring bulan |
| Pencapaian | Riwayat target tercapai, tahapan terbaru, statistik sepanjang waktu |
| Pengaturan | Profil, zona waktu, ganti password, ekspor data JSON |

## Menjalankan

```bash
npm install
cp .env.example .env.local   # isi kunci Supabase
npm run dev
```

## Database

Migrasi ada di `supabase/migrations/`. Isi `DATABASE_URL` di `.env.local` (Dashboard → Connect →
**Session pooler**; host langsung `db.<ref>.supabase.co` hanya IPv6), lalu:

```bash
npm run db:migrate              # terapkan migrasi yang tertunda (1 transaksi per file)
npm run db:migrate -- --status  # lihat status saja
```

Riwayat dicatat di `supabase_migrations.schema_migrations`, kompatibel dengan Supabase CLI.

Skema memakai RLS di semua tabel, FK komposit `(id, user_id)` agar relasi lintas akun ditolak database,
view `goal_progress` (security_invoker) sebagai satu sumber kebenaran progres, dan trigger `sync_goal`
yang menandai tahapan/target tercapai secara idempoten.

### Auth

Di Supabase → Authentication → URL Configuration, tambahkan `http://localhost:3000/auth/confirm`
dan URL produksi `/auth/confirm` ke Redirect URLs.

## Pengingat & Bot Telegram

- **Tugas berulang** (harian/mingguan/bulanan): saat ditandai selesai, trigger DB membuat jadwal berikutnya tepat sekali.
- **Pengingat**: kolom "Ingatkan" di tugas/kegiatan. `pg_cron` di Supabase memanggil `/api/cron/pengingat`
  setiap 5 menit; pengingat diklaim atomik (tidak terkirim dua kali), gagal kirim dicatat di `reminder_logs`
  dan dicoba lagi (maks. 5×). Ringkasan harian dikirim sekali sehari pada jam pilihan pengguna.
- **Bot**: `/api/telegram/webhook` (header rahasia, `update_id` idempoten, hanya chat pribadi, akun harus
  ditautkan lewat kode sekali pakai dari Pengaturan). Perintah: `/tugas /catat /belajar /target /pengingat /bantuan /putus`.
  Menyimpan data selalu lewat tombol konfirmasi.

Menyiapkan:

1. Buat bot di **@BotFather**, isi `TELEGRAM_BOT_TOKEN` di `.env.local`.
2. `npm run setup:bot -- --url https://domain-produksi` — membuat `CRON_SECRET` & `TELEGRAM_WEBHOOK_SECRET`
   bila kosong, menjadwalkan pg_cron, memasang webhook & daftar perintah, mengisi `TELEGRAM_BOT_USERNAME`.
3. Salin `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
   `TELEGRAM_BOT_USERNAME` ke Vercel → Settings → Environment Variables, lalu redeploy.
