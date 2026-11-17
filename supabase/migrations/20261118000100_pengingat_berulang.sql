-- =====================================================================
-- Pengingat berulang lewat Bot Telegram ("/ingatkan tiap hari jam 7 minum obat").
--
--  * bot_timers.repeat: pola pengulangan pengingat bebas —
--      'harian'            setiap hari
--      'kerja'             Senin–Jumat
--      'mingguan:0,3'      hari tertentu (0 = Senin … 6 = Minggu)
--    Saat berbunyi, cron membuat baris berikutnya (jam yang sama di zona pengguna).
--    Membatalkan baris yang menunggu = menghentikan pengulangan.
--  * claim_due_timers ikut mengembalikan kolom repeat.
-- =====================================================================
alter table public.bot_timers add column repeat text;
alter table public.bot_timers add constraint bot_timers_repeat_check
  check (repeat is null or (kind = 'ingat' and repeat ~ '^(harian|kerja|mingguan:[0-6](,[0-6]){0,6})$'));

drop function public.claim_due_timers(integer);
create function public.claim_due_timers(p_limit integer default 200)
returns table (id uuid, user_id uuid, kind text, label text, minutes integer, fire_at timestamptz, attempts smallint, repeat text, chat_id bigint, timezone text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select t.id from public.bot_timers t
    where t.sent_at is null and t.attempts < 5 and t.fire_at <= now() and t.fire_at > now() - interval '6 hours'
    order by t.fire_at
    limit least(greatest(p_limit, 1), 500)
    for update of t skip locked
  ), claimed as (
    update public.bot_timers t set sent_at = now() from due where t.id = due.id
    returning t.id, t.user_id, t.kind, t.label, t.minutes, t.fire_at, t.attempts, t.repeat
  )
  select c.id, c.user_id, c.kind, c.label, c.minutes, c.fire_at, c.attempts, c.repeat, tc.chat_id, coalesce(p.timezone, 'Asia/Jakarta')
  from claimed c
  left join public.telegram_connections tc on tc.user_id = c.user_id
  left join public.profiles p on p.id = c.user_id;
$$;
revoke execute on function public.claim_due_timers(integer) from public, anon, authenticated;
grant execute on function public.claim_due_timers(integer) to service_role;
