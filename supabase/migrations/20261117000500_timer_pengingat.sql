-- =====================================================================
-- Timer & "ingatkan saya" lewat Bot Telegram + cek sore tugas yang belum selesai.
--
--  * bot_timers: timer hitung mundur (/timer 25) dan pengingat bebas (/ingatkan 14.30 rapat).
--    Dikirim oleh cron (setiap menit); diklaim atomik → tidak terkirim dua kali.
--  * profiles.last_evening_on: cek sore dikirim sekali per hari.
--  * reminder_logs menerima jenis 'timer' & 'sore'.
-- Hanya server (service role) yang menulis; pengguna boleh membaca miliknya sendiri.
-- =====================================================================
create table public.bot_timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('timer', 'ingat')),
  label text not null default '' check (char_length(label) <= 200),
  minutes integer check (minutes is null or minutes between 1 and 1440),
  fire_at timestamptz not null,
  sent_at timestamptz,
  attempts smallint not null default 0,
  created_at timestamptz not null default now()
);
create index bot_timers_due_idx on public.bot_timers (fire_at) where sent_at is null;
create index bot_timers_user_idx on public.bot_timers (user_id, sent_at);

alter table public.bot_timers enable row level security;
create policy "timer sendiri: baca" on public.bot_timers for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.bot_timers from anon, authenticated;
revoke all on public.bot_timers from anon;

alter table public.profiles add column last_evening_on date;

alter table public.reminder_logs drop constraint reminder_logs_kind_check;
alter table public.reminder_logs add constraint reminder_logs_kind_check check (kind in ('tugas', 'ringkasan', 'timer', 'sore'));

-- Klaim timer yang sudah waktunya (dilewati bila terlambat > 6 jam, mis. server mati lama).
create or replace function public.claim_due_timers(p_limit integer default 200)
returns table (id uuid, user_id uuid, kind text, label text, minutes integer, fire_at timestamptz, attempts smallint, chat_id bigint, timezone text)
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
    returning t.id, t.user_id, t.kind, t.label, t.minutes, t.fire_at, t.attempts
  )
  select c.id, c.user_id, c.kind, c.label, c.minutes, c.fire_at, c.attempts, tc.chat_id, coalesce(p.timezone, 'Asia/Jakarta')
  from claimed c
  left join public.telegram_connections tc on tc.user_id = c.user_id
  left join public.profiles p on p.id = c.user_id;
$$;
revoke execute on function public.claim_due_timers(integer) from public, anon, authenticated;
grant execute on function public.claim_due_timers(integer) to service_role;
