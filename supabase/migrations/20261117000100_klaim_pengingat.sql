-- =====================================================================
-- Klaim pengingat yang jatuh tempo (dipanggil endpoint cron, service role).
--
-- Waktu acuan: kegiatan → start_at; tugas → due_at, atau start_at bila tanpa tenggat.
-- Pengingat dikirim saat now() >= acuan − remind_before_minutes, dan dilewati bila
-- acuannya sudah lewat > 6 jam (mis. server mati lama) agar tidak membanjiri chat.
--
-- Baris langsung ditandai reminded_at = now() dalam satu UPDATE … FOR UPDATE SKIP
-- LOCKED, sehingga dua putaran cron yang bertumpuk tidak mengirim pengingat dua kali.
-- Bila pengiriman gagal, server mengembalikan reminded_at = null dan menaikkan
-- remind_attempts (maks. 5 percobaan).
-- =====================================================================

create or replace function public.claim_due_reminders(p_limit integer default 100)
returns table (
  id uuid, user_id uuid, kind text, title text, due_at timestamptz, start_at timestamptz, end_at timestamptz,
  location text, remind_before_minutes integer, remind_attempts smallint, chat_id bigint, timezone text
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select t.id
    from public.tasks t
    where t.remind_before_minutes is not null
      and t.reminded_at is null
      and t.remind_attempts < 5
      and t.status in ('belum', 'dikerjakan', 'tertunda')
      and (case when t.kind = 'kegiatan' then t.start_at else coalesce(t.due_at, t.start_at) end)
          - make_interval(mins => t.remind_before_minutes) <= now()
      and (case when t.kind = 'kegiatan' then t.start_at else coalesce(t.due_at, t.start_at) end)
          > now() - interval '6 hours'
    order by (case when t.kind = 'kegiatan' then t.start_at else coalesce(t.due_at, t.start_at) end)
    limit least(greatest(p_limit, 1), 500)
    for update of t skip locked
  ), claimed as (
    update public.tasks t set reminded_at = now()
    from due where t.id = due.id
    returning t.id, t.user_id, t.kind, t.title, t.due_at, t.start_at, t.end_at, t.location, t.remind_before_minutes, t.remind_attempts
  )
  select c.id, c.user_id, c.kind, c.title, c.due_at, c.start_at, c.end_at, c.location, c.remind_before_minutes, c.remind_attempts,
         tc.chat_id, coalesce(p.timezone, 'Asia/Jakarta')
  from claimed c
  left join public.telegram_connections tc on tc.user_id = c.user_id
  left join public.profiles p on p.id = c.user_id;
$$;

revoke execute on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;

-- Indeks parsial: hanya tugas yang masih menunggu pengingat.
drop index if exists public.tasks_reminder_due_idx;
create index tasks_reminder_pending_idx on public.tasks (coalesce(due_at, start_at))
  where remind_before_minutes is not null and reminded_at is null;
