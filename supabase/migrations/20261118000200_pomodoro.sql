-- =====================================================================
-- Mode Pomodoro lewat Bot Telegram ("/fokus", "/fokus 50 skripsi").
--
--  * bot_timers.kind menerima 'fokus' (sesi fokus) dan 'rehat' (istirahat).
--  * bot_timers.pomo: keadaan siklus, mis. {"n":2,"of":4,"focus":25,"rest":5,"long":15}.
--    Saat sesi berbunyi, cron membuat langkah berikutnya (fokus → istirahat → fokus …).
--  * Sesi fokus yang selesai disimpan 8 hari untuk rekap "fokus hari ini".
--  * claim_due_timers ikut mengembalikan kolom pomo.
-- =====================================================================
alter table public.bot_timers drop constraint bot_timers_kind_check;
alter table public.bot_timers add constraint bot_timers_kind_check check (kind in ('timer', 'ingat', 'fokus', 'rehat'));
alter table public.bot_timers add column pomo jsonb;
alter table public.bot_timers add constraint bot_timers_pomo_check
  check (pomo is null or (kind in ('fokus', 'rehat') and jsonb_typeof(pomo) = 'object'));
create index bot_timers_fokus_idx on public.bot_timers (user_id, sent_at) where kind = 'fokus';

drop function public.claim_due_timers(integer);
create function public.claim_due_timers(p_limit integer default 200)
returns table (id uuid, user_id uuid, kind text, label text, minutes integer, fire_at timestamptz, attempts smallint, repeat text, pomo jsonb, chat_id bigint, timezone text)
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
    returning t.id, t.user_id, t.kind, t.label, t.minutes, t.fire_at, t.attempts, t.repeat, t.pomo
  )
  select c.id, c.user_id, c.kind, c.label, c.minutes, c.fire_at, c.attempts, c.repeat, c.pomo, tc.chat_id, coalesce(p.timezone, 'Asia/Jakarta')
  from claimed c
  left join public.telegram_connections tc on tc.user_id = c.user_id
  left join public.profiles p on p.id = c.user_id;
$$;
revoke execute on function public.claim_due_timers(integer) from public, anon, authenticated;
grant execute on function public.claim_due_timers(integer) to service_role;
