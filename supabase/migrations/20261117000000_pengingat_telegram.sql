-- =====================================================================
-- Ruang Produktivitas — Tahap 2: Tugas berulang, pengingat, Bot Telegram
-- (TG-06, BT-01 … BT-09, UJ-07, UJ-08, UJ-12)
--
--  * tasks.recurrence: saat tugas berulang ditandai selesai, tugas berikutnya
--    dibuat SEKALI (next_spawned_at mencegah duplikasi bila dibuka-tutup ulang).
--  * tasks.remind_before_minutes: pengingat dihitung dari jadwal/tenggat.
--    reminded_at diisi setelah terkirim; diubah jadwalnya → direset otomatis.
--    Gagal kirim → remind_attempts naik & dicatat di reminder_logs, dicoba lagi
--    pada putaran berikutnya (maks. 5 kali).
--  * Telegram: koneksi akun, kode tautan sekali pakai (berlaku 10 menit),
--    telegram_updates (update_id unik → pesan yang dikirim ulang tidak diproses
--    dua kali), dan telegram_pending (konfirmasi sebelum menyimpan teks bebas).
--  * Tabel Telegram & log hanya diakses server (service role); pengguna hanya
--    bisa membaca koneksinya sendiri.
-- =====================================================================

-- ---------- Tugas berulang & pengingat ----------
alter table public.tasks
  add column recurrence text not null default 'tidak' check (recurrence in ('tidak', 'harian', 'mingguan', 'bulanan')),
  add column next_spawned_at timestamptz,
  add column remind_before_minutes integer check (remind_before_minutes is null or remind_before_minutes between 0 and 10080),
  add column reminded_at timestamptz,
  add column remind_attempts smallint not null default 0;

create index tasks_reminder_due_idx on public.tasks (reminded_at, status) where remind_before_minutes is not null;

-- Jadwal/tenggat/pengingat berubah → pengingat boleh dikirim lagi.
create or replace function public.tasks_reset_reminder()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.due_at is distinct from old.due_at
     or new.start_at is distinct from old.start_at
     or new.remind_before_minutes is distinct from old.remind_before_minutes then
    new.reminded_at := null;
    new.remind_attempts := 0;
  end if;
  return new;
end; $$;
create trigger tasks_reset_reminder before update of due_at, start_at, remind_before_minutes on public.tasks
  for each row execute function public.tasks_reset_reminder();

-- Tugas berulang selesai → buat kejadian berikutnya (sekali).
create or replace function public.tasks_spawn_next()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_step interval;
begin
  if new.status = 'selesai' and old.status is distinct from 'selesai'
     and new.recurrence <> 'tidak' and new.next_spawned_at is null then
    v_step := case new.recurrence when 'harian' then interval '1 day' when 'mingguan' then interval '7 days' else interval '1 month' end;
    insert into public.tasks (user_id, kind, title, description, category, priority, status, due_at, start_at, end_at, location,
                              goal_id, project_id, subject_id, recurrence, remind_before_minutes)
    values (new.user_id, new.kind, new.title, new.description, new.category, new.priority, 'belum',
            new.due_at + v_step, new.start_at + v_step, new.end_at + v_step, new.location,
            new.goal_id, new.project_id, new.subject_id, new.recurrence, new.remind_before_minutes);
    update public.tasks set next_spawned_at = now() where id = new.id;
  end if;
  return null;
end; $$;
create trigger tasks_spawn_next after update of status on public.tasks
  for each row execute function public.tasks_spawn_next();

-- ---------- Preferensi notifikasi ----------
alter table public.profiles
  add column last_digest_on date;
-- notification_settings (jsonb, sudah ada): {"digest": true, "digest_time": "07:00"}

-- ---------- Log pengiriman pengingat (UJ-12) ----------
create table public.reminder_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  kind text not null check (kind in ('tugas', 'ringkasan')),
  status text not null check (status in ('terkirim', 'gagal', 'dilewati')),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index reminder_logs_user_idx on public.reminder_logs (user_id, created_at desc);
create index reminder_logs_task_idx on public.reminder_logs (task_id);

-- ---------- Telegram ----------
create table public.telegram_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  telegram_user_id bigint not null unique,
  chat_id bigint not null,
  username text not null default '',
  linked_at timestamptz not null default now()
);

create table public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index telegram_link_codes_user_idx on public.telegram_link_codes (user_id);

create table public.telegram_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now(),
  status text not null default 'diproses' check (status in ('diproses', 'selesai', 'gagal', 'diabaikan'))
);

create table public.telegram_pending (
  chat_id bigint primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('catat', 'belajar')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index telegram_pending_user_idx on public.telegram_pending (user_id);

-- ---------- RLS ----------
alter table public.reminder_logs enable row level security;
create policy "log sendiri: baca" on public.reminder_logs for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.reminder_logs from anon, authenticated;
revoke all on public.reminder_logs from anon;

alter table public.telegram_connections enable row level security;
create policy "koneksi sendiri: baca" on public.telegram_connections for select to authenticated using (user_id = (select auth.uid()));
create policy "koneksi sendiri: putuskan" on public.telegram_connections for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.telegram_connections from anon, authenticated;
revoke all on public.telegram_connections from anon;

-- Kode tautan dibuat lewat server (service role) agar tidak bisa ditebak/diulang dari browser.
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;

alter table public.telegram_updates enable row level security;
revoke all on public.telegram_updates from anon, authenticated;

alter table public.telegram_pending enable row level security;
revoke all on public.telegram_pending from anon, authenticated;

revoke execute on function public.tasks_reset_reminder() from public, anon, authenticated;
revoke execute on function public.tasks_spawn_next() from public, anon, authenticated;
