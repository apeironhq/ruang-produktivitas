-- =====================================================================
-- Bot Telegram lengkap: isian bertahap (alur) & evaluasi lencana dari bot.
-- =====================================================================

-- telegram_pending kini juga menyimpan isian bertahap (alur: tugas, kegiatan, catatan,
-- sesi belajar, transaksi, progres target) dan teks bebas yang menunggu pilihan.
alter table public.telegram_pending drop constraint telegram_pending_action_check;
alter table public.telegram_pending add constraint telegram_pending_action_check
  check (action in ('catat', 'belajar', 'tugas', 'alur', 'teks'));

-- evaluate_achievements() memakai auth.uid(); bot (service role) tidak punya sesi pengguna.
-- Pembungkus ini menyetel klaim sub HANYA untuk transaksi ini lalu memanggil fungsi asli,
-- sehingga semua metrik tetap dibatasi ke user_id pengguna tersebut. Hanya service role.
create or replace function public.evaluate_achievements_for(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then return 0; end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  return public.evaluate_achievements();
end;
$$;
revoke execute on function public.evaluate_achievements_for(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_achievements_for(uuid) to service_role;
