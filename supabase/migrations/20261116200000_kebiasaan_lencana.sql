-- =====================================================================
-- Ruang Produktivitas — Tahap 2: Kebiasaan & Lencana (PC-02 … PC-05)
--  * habits + habit_checkins: satu check-in per kebiasaan per hari (unik).
--  * achievements: definisi lencana global dengan aturan {metric, min}.
--  * user_achievements: lencana yang diraih — unik per pengguna & lencana
--    sehingga pemrosesan ulang tidak memberi lencana dua kali (PC-04).
--  * evaluate_achievements(): menghitung metrik pengguna yang sedang masuk
--    lalu memberi lencana yang syaratnya terpenuhi (idempoten).
-- =====================================================================

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  frequency text not null default 'harian' check (frequency in ('harian', 'mingguan')),
  -- untuk kebiasaan mingguan: berapa kali per minggu (1–7)
  times_per_week smallint not null default 7 check (times_per_week between 1 and 7),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index habits_user_idx on public.habits (user_id, is_archived);
create trigger habits_updated_at before update on public.habits
  for each row execute function public.set_updated_at();

create table public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null,
  checkin_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, habit_id, checkin_date),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade
);
create index habit_checkins_habit_idx on public.habit_checkins (habit_id, checkin_date desc);
create index habit_checkins_user_date_idx on public.habit_checkins (user_id, checkin_date desc);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  icon text not null default 'award',
  metric text not null,
  min_value integer not null check (min_value > 0),
  sort_order integer not null default 0
);

create table public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);
create index user_achievements_user_idx on public.user_achievements (user_id, earned_at desc);
create index user_achievements_achievement_idx on public.user_achievements (achievement_id);

insert into public.achievements (code, name, description, icon, metric, min_value, sort_order) values
  ('tugas_1',      'Langkah pertama',      'Selesaikan tugas pertama',                 'check',    'tasks_done',       1,   10),
  ('tugas_10',     'Produktif',            'Selesaikan 10 tugas',                      'check',    'tasks_done',       10,  11),
  ('tugas_50',     'Mesin produktivitas',  'Selesaikan 50 tugas',                      'check',    'tasks_done',       50,  12),
  ('modul_10',     'Pembelajar tekun',     'Selesaikan 10 modul belajar',              'book',     'modules_done',     10,  20),
  ('belajar_600',  '10 jam belajar',       'Kumpulkan 600 menit sesi belajar',         'clock',    'learning_minutes', 600, 21),
  ('belajar_3000', '50 jam belajar',       'Kumpulkan 3.000 menit sesi belajar',       'clock',    'learning_minutes', 3000, 22),
  ('target_1',     'Target pertama',       'Capai target pertama',                     'target',   'goals_achieved',   1,   30),
  ('target_5',     'Penakluk target',      'Capai 5 target',                           'target',   'goals_achieved',   5,   31),
  ('proyek_1',     'Proyek rampung',       'Selesaikan proyek pertama',                'folder',   'projects_done',    1,   40),
  ('catatan_10',   'Penulis rajin',        'Tulis 10 catatan atau jurnal',             'note',     'notes_written',    10,  50),
  ('streak_7',     'Konsisten 7 hari',     'Check-in kebiasaan 7 hari berturut-turut', 'flame',    'best_streak',      7,   60),
  ('streak_30',    'Kebiasaan terbentuk',  'Check-in kebiasaan 30 hari berturut-turut','flame',    'best_streak',      30,  61),
  ('checkin_100',  '100 check-in',         'Kumpulkan 100 check-in kebiasaan',         'repeat',   'checkins',         100, 62);

-- Metrik pengguna yang sedang masuk (dipakai evaluasi lencana & tampilan progres lencana).
create or replace function public.my_achievement_metrics()
returns table (metric text, value bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'tasks_done', count(*) from public.tasks where status = 'selesai'
  union all select 'modules_done', count(*) from public.learning_modules where completed_at is not null and is_applicable
  union all select 'learning_minutes', coalesce(sum(duration_minutes), 0) from public.learning_sessions
  union all select 'goals_achieved', count(*) from public.goals where achieved_at is not null
  union all select 'projects_done', count(*) from public.projects where status = 'selesai'
  union all select 'notes_written', count(*) from public.journal_entries
  union all select 'checkins', count(*) from public.habit_checkins
  union all select 'best_streak', coalesce(max(run), 0) from (
    select count(*) as run
    from (
      select habit_id, checkin_date - (row_number() over (partition by habit_id order by checkin_date))::int as grp
      from public.habit_checkins
    ) s
    group by habit_id, grp
  ) r;
$$;
revoke execute on function public.my_achievement_metrics() from public, anon;
grant execute on function public.my_achievement_metrics() to authenticated;

-- Beri lencana yang syaratnya terpenuhi. SECURITY DEFINER karena pengguna tidak boleh menulis
-- user_achievements langsung (mencegah "memberi lencana sendiri"). Karena RLS tidak berlaku di
-- dalam fungsi definer, setiap metrik dibatasi eksplisit ke user_id = auth.uid().
create or replace function public.evaluate_achievements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then
    return 0;
  end if;
  with m as (
    select 'tasks_done' as metric, count(*)::bigint as value from public.tasks where user_id = v_uid and status = 'selesai'
    union all select 'modules_done', count(*) from public.learning_modules where user_id = v_uid and completed_at is not null and is_applicable
    union all select 'learning_minutes', coalesce(sum(duration_minutes), 0) from public.learning_sessions where user_id = v_uid
    union all select 'goals_achieved', count(*) from public.goals where user_id = v_uid and achieved_at is not null
    union all select 'projects_done', count(*) from public.projects where user_id = v_uid and status = 'selesai'
    union all select 'notes_written', count(*) from public.journal_entries where user_id = v_uid
    union all select 'checkins', count(*) from public.habit_checkins where user_id = v_uid
    union all select 'best_streak', coalesce(max(run), 0) from (
      select count(*) as run from (
        select habit_id, checkin_date - (row_number() over (partition by habit_id order by checkin_date))::int as grp
        from public.habit_checkins where user_id = v_uid
      ) s group by habit_id, grp
    ) r
  ), ins as (
    insert into public.user_achievements (user_id, achievement_id)
    select v_uid, a.id
    from public.achievements a
    join m on m.metric = a.metric and m.value >= a.min_value
    on conflict (user_id, achievement_id) do nothing
    returning 1
  )
  select count(*) into v_new from ins;
  return v_new;
end;
$$;
revoke execute on function public.evaluate_achievements() from public, anon;
grant execute on function public.evaluate_achievements() to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['habits', 'habit_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "milik sendiri: baca" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: tambah" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: ubah" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: hapus" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Definisi lencana: boleh dibaca semua pengguna masuk, tidak bisa diubah lewat API.
alter table public.achievements enable row level security;
create policy "definisi lencana: baca" on public.achievements for select to authenticated using (true);
revoke insert, update, delete on public.achievements from anon, authenticated;
revoke all on public.achievements from anon;

-- Lencana milik pengguna: hanya bisa dibaca; pemberian lewat evaluate_achievements().
alter table public.user_achievements enable row level security;
create policy "lencana sendiri: baca" on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.user_achievements from anon, authenticated;
revoke all on public.user_achievements from anon;
