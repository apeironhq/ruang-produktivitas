-- =====================================================================
-- Asisten AI: usulan AI yang menunggu konfirmasi disimpan di telegram_pending (action 'ai').
-- =====================================================================
alter table public.telegram_pending drop constraint telegram_pending_action_check;
alter table public.telegram_pending add constraint telegram_pending_action_check
  check (action in ('catat', 'belajar', 'tugas', 'alur', 'teks', 'ai'));
