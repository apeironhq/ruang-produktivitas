-- Bot Telegram: /tambah membuat tugas, tetap lewat tombol konfirmasi (BT-04).
alter table public.telegram_pending drop constraint telegram_pending_action_check;
alter table public.telegram_pending add constraint telegram_pending_action_check check (action in ('catat', 'belajar', 'tugas'));
