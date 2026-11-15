-- =====================================================================
-- Ruang Produktivitas — Tahap 1 (P0)
-- Profil, Target, Ruang Belajar, Tugas & Kegiatan, Proyek (dasar), Catatan & Jurnal.
--
-- Prinsip:
--  * Setiap baris milik satu pengguna (user_id = auth.uid()), dikunci RLS.
--  * Relasi antar-entitas memakai FK komposit (id, user_id) sehingga database
--    sendiri menolak menautkan data milik pengguna lain.
--  * Progres target TIDAK disimpan sebagai angka bebas: dihitung oleh view
--    goal_progress dari satu sumber (kontribusi manual / modul / tugas).
--  * Status "tercapai" ditetapkan sekali oleh sync_goal() (idempoten).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitas
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Profil
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  timezone text not null default 'Asia/Jakarta' check (char_length(timezone) <= 64),
  notification_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profil dibuat otomatis saat akun mendaftar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Target
-- ---------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  category text not null default '' check (char_length(category) <= 60),
  -- rupiah | jumlah | durasi (menit) | persentase | biner (selesai/belum)
  metric_type text not null default 'jumlah' check (metric_type in ('rupiah', 'jumlah', 'durasi', 'persentase', 'biner')),
  unit_label text not null default '' check (char_length(unit_label) <= 30),
  -- naik: menambah (menabung); turun: mengurangi (melunasi utang, menurunkan berat badan)
  direction text not null default 'naik' check (direction in ('naik', 'turun')),
  -- sumber progres tunggal (PRD §8: tidak menumpuk progres manual di atas progres turunan)
  progress_source text not null default 'manual' check (progress_source in ('manual', 'modul', 'tugas')),
  start_value numeric(18, 2) not null default 0,
  target_value numeric(18, 2) not null default 0,
  priority text not null default 'sedang' check (priority in ('rendah', 'sedang', 'tinggi')),
  start_date date not null default current_date,
  due_date date,
  status text not null default 'aktif' check (status in ('aktif', 'tercapai', 'arsip')),
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint goals_manual_range check (
    progress_source <> 'manual'
    or (direction = 'naik' and target_value > start_value)
    or (direction = 'turun' and target_value < start_value)
  ),
  constraint goals_due_after_start check (due_date is null or due_date >= start_date)
);
create index goals_user_status_idx on public.goals (user_id, status);
create trigger goals_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  title text not null default '' check (char_length(title) <= 120),
  -- ambang dalam satuan target (untuk sumber modul/tugas: jumlah item selesai)
  threshold numeric(18, 2) not null,
  reached_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index goal_milestones_goal_idx on public.goal_milestones (goal_id, threshold);
create index goal_milestones_user_idx on public.goal_milestones (user_id);

-- Kontribusi manual (+/-) terhadap target bersumber "manual". Bukan transaksi keuangan.
create table public.goal_progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  value numeric(18, 2) not null check (value <> 0),
  note text not null default '' check (char_length(note) <= 500),
  occurred_on date not null default current_date,
  source_type text not null default 'manual' check (source_type in ('manual', 'telegram')),
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);
create index goal_progress_events_goal_idx on public.goal_progress_events (goal_id, occurred_on desc);
create index goal_progress_events_user_idx on public.goal_progress_events (user_id);

-- ---------------------------------------------------------------------
-- Proyek (dasar — dibutuhkan relasi tugas; halaman lengkap di Tahap 2)
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'aktif' check (status in ('rencana', 'aktif', 'selesai', 'ditunda', 'arsip')),
  start_date date,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index projects_user_idx on public.projects (user_id, status);
create index projects_goal_idx on public.projects (goal_id);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Ruang Belajar
-- ---------------------------------------------------------------------
create table public.learning_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'aktif' check (status in ('aktif', 'selesai', 'arsip')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id)
);
create index learning_subjects_user_idx on public.learning_subjects (user_id, status);
create index learning_subjects_goal_idx on public.learning_subjects (goal_id);
create trigger learning_subjects_updated_at before update on public.learning_subjects
  for each row execute function public.set_updated_at();

create table public.learning_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  source_type text not null default 'tautan' check (source_type in ('tautan', 'buku', 'pdf', 'video', 'kursus', 'catatan')),
  url text not null default '' check (char_length(url) <= 2000),
  -- posisi terakhir: "Bab 4", "hal. 120", "menit 34:10", "Modul 7"
  position text not null default '' check (char_length(position) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete cascade
);
create index learning_sources_subject_idx on public.learning_sources (subject_id);
create index learning_sources_user_idx on public.learning_sources (user_id);
create trigger learning_sources_updated_at before update on public.learning_sources
  for each row execute function public.set_updated_at();

create table public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  sort_order integer not null default 0,
  -- modul yang tidak berlaku (dilewati) tidak dihitung dalam total progres
  is_applicable boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete cascade
);
create index learning_modules_subject_idx on public.learning_modules (subject_id, sort_order);
create index learning_modules_user_idx on public.learning_modules (user_id);

create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  source_id uuid,
  module_id uuid,
  session_date date not null default current_date,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  material text not null default '' check (char_length(material) <= 200),
  position text not null default '' check (char_length(position) <= 120),
  summary text not null default '' check (char_length(summary) <= 4000),
  obstacles text not null default '' check (char_length(obstacles) <= 2000),
  next_steps text not null default '' check (char_length(next_steps) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete cascade,
  foreign key (source_id, user_id) references public.learning_sources (id, user_id) on delete set null (source_id),
  foreign key (module_id, user_id) references public.learning_modules (id, user_id) on delete set null (module_id)
);
create index learning_sessions_user_date_idx on public.learning_sessions (user_id, session_date desc);
create index learning_sessions_subject_idx on public.learning_sessions (subject_id, session_date desc);
create index learning_sessions_source_idx on public.learning_sessions (source_id);
create index learning_sessions_module_idx on public.learning_sessions (module_id);

-- ---------------------------------------------------------------------
-- Tugas & Kegiatan
--   kind = 'tugas'    → status alur kerja + tenggat (due_at) + subtugas
--   kind = 'kegiatan' → jadwal (start_at–end_at) + lokasi
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'tugas' check (kind in ('tugas', 'kegiatan')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  category text not null default '' check (char_length(category) <= 60),
  priority text not null default 'sedang' check (priority in ('rendah', 'sedang', 'tinggi', 'mendesak')),
  status text not null default 'belum' check (status in ('belum', 'dikerjakan', 'tertunda', 'selesai', 'dibatalkan')),
  due_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  location text not null default '' check (char_length(location) <= 200),
  completed_at timestamptz,
  goal_id uuid,
  project_id uuid,
  subject_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint tasks_kegiatan_has_start check (kind <> 'kegiatan' or start_at is not null),
  constraint tasks_end_after_start check (end_at is null or start_at is null or end_at >= start_at),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete set null (subject_id)
);
create index tasks_user_status_idx on public.tasks (user_id, status);
create index tasks_user_due_idx on public.tasks (user_id, due_at);
create index tasks_user_start_idx on public.tasks (user_id, start_at);
create index tasks_goal_idx on public.tasks (goal_id);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_subject_idx on public.tasks (subject_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Waktu selesai dicatat otomatis dan konsisten dengan status.
create or replace function public.tasks_track_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'selesai' and (tg_op = 'INSERT' or old.status is distinct from 'selesai') then
    new.completed_at := now();
  elsif new.status <> 'selesai' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_completion before insert or update of status on public.tasks
  for each row execute function public.tasks_track_completion();

create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index task_subtasks_task_idx on public.task_subtasks (task_id, sort_order);
create index task_subtasks_user_idx on public.task_subtasks (user_id);

-- ---------------------------------------------------------------------
-- Catatan & Jurnal (satu tabel, dibedakan "kind")
-- ---------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'catatan' check (kind in ('catatan', 'harian', 'belajar', 'trading', 'pekerjaan', 'ide', 'khusus')),
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 50000),
  entry_date date not null default current_date,
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  -- kolom khusus jurnal trading: instrumen, strategi, harga masuk/keluar, biaya, hasil, evaluasi
  trading jsonb,
  mood smallint check (mood between 1 and 5),
  is_archived boolean not null default false,
  goal_id uuid,
  project_id uuid,
  subject_id uuid,
  task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_has_body check (char_length(title) > 0 or char_length(content) > 0),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete set null (goal_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete set null (subject_id),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id)
);
create index journal_entries_user_date_idx on public.journal_entries (user_id, is_archived, entry_date desc);
create index journal_entries_user_kind_idx on public.journal_entries (user_id, kind);
create index journal_entries_tags_idx on public.journal_entries using gin (tags);
create index journal_entries_goal_idx on public.journal_entries (goal_id);
create index journal_entries_project_idx on public.journal_entries (project_id);
create index journal_entries_subject_idx on public.journal_entries (subject_id);
create index journal_entries_task_idx on public.journal_entries (task_id);
create trigger journal_entries_updated_at before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Progres target: satu view, satu sumber kebenaran per target
-- =====================================================================
create or replace view public.goal_progress
with (security_invoker = true)
as
select
  g.id as goal_id,
  g.user_id,
  case g.progress_source
    when 'manual' then g.start_value + coalesce(ev.total, 0)
    when 'modul' then coalesce(md.done, 0)::numeric
    when 'tugas' then coalesce(tk.done, 0)::numeric
  end as current_value,
  case g.progress_source
    when 'manual' then g.target_value
    when 'modul' then coalesce(md.total, 0)::numeric
    when 'tugas' then coalesce(tk.total, 0)::numeric
  end as effective_target,
  case g.progress_source
    when 'manual' then g.start_value
    else 0::numeric
  end as effective_start,
  coalesce(md.total, tk.total, 0) as item_total,
  coalesce(md.done, tk.done, 0) as item_done
from public.goals g
left join lateral (
  select sum(e.value) as total
  from public.goal_progress_events e
  where e.goal_id = g.id
) ev on g.progress_source = 'manual'
left join lateral (
  select count(*) filter (where m.is_applicable) as total,
         count(*) filter (where m.is_applicable and m.completed_at is not null) as done
  from public.learning_modules m
  join public.learning_subjects s on s.id = m.subject_id
  where s.goal_id = g.id
) md on g.progress_source = 'modul'
left join lateral (
  select count(*) filter (where t.status <> 'dibatalkan') as total,
         count(*) filter (where t.status = 'selesai') as done
  from public.tasks t
  where t.goal_id = g.id
) tk on g.progress_source = 'tugas';

-- Persentase: (saat_ini - awal) / (target - awal) × 100, dijepit 0..100.
-- Untuk target "turun" pembilang & penyebut sama-sama negatif sehingga rumusnya tetap benar.
create or replace function public.progress_percent(p_current numeric, p_start numeric, p_target numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_target = p_start then 0
    else least(100, greatest(0, round((p_current - p_start) / (p_target - p_start) * 100, 2)))
  end;
$$;

-- Tandai tahapan & status tercapai. Idempoten: hanya baris yang belum tercapai yang diperbarui,
-- sehingga pemrosesan ulang (mis. kiriman ganda) tidak mencatat pencapaian dua kali.
create or replace function public.sync_goal(p_goal_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.goals;
  v_cur numeric;
  v_target numeric;
  v_start numeric;
  v_items bigint;
begin
  if p_goal_id is null then
    return;
  end if;
  select * into v_goal from public.goals where id = p_goal_id;
  if not found then
    return;
  end if;
  select current_value, effective_target, effective_start, item_total
    into v_cur, v_target, v_start, v_items
  from public.goal_progress where goal_id = p_goal_id;

  -- tahapan: tercapai saat nilai saat ini melewati ambang (arah naik/turun)
  update public.goal_milestones m
     set reached_at = now()
   where m.goal_id = p_goal_id
     and m.reached_at is null
     and case when v_goal.direction = 'turun' and v_goal.progress_source = 'manual'
              then v_cur <= m.threshold else v_cur >= m.threshold end;

  if v_goal.status = 'aktif'
     and (v_goal.progress_source = 'manual' or v_items > 0)
     and public.progress_percent(v_cur, v_start, v_target) >= 100 then
    update public.goals
       set status = 'tercapai', achieved_at = now()
     where id = p_goal_id and status = 'aktif';
  end if;
end;
$$;

-- Pemicu: setiap perubahan yang memengaruhi progres langsung menyinkronkan targetnya.
create or replace function public.trg_sync_goal_from_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.sync_goal(coalesce(new.goal_id, old.goal_id));
  return null;
end; $$;
create trigger goal_progress_events_sync after insert or update or delete on public.goal_progress_events
  for each row execute function public.trg_sync_goal_from_event();

create or replace function public.trg_sync_goal_from_task()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.goal_id is not null then
    perform public.sync_goal(old.goal_id);
  end if;
  if tg_op = 'INSERT' and new.goal_id is not null then
    perform public.sync_goal(new.goal_id);
  elsif tg_op = 'UPDATE' and new.goal_id is not null and new.goal_id is distinct from old.goal_id then
    perform public.sync_goal(new.goal_id);
  end if;
  return null;
end; $$;
create trigger tasks_sync_goal after insert or update of status, goal_id or delete on public.tasks
  for each row execute function public.trg_sync_goal_from_task();

create or replace function public.trg_sync_goal_from_module()
returns trigger language plpgsql set search_path = '' as $$
declare v_goal uuid;
begin
  select goal_id into v_goal from public.learning_subjects where id = coalesce(new.subject_id, old.subject_id);
  perform public.sync_goal(v_goal);
  return null;
end; $$;
create trigger learning_modules_sync_goal after insert or update or delete on public.learning_modules
  for each row execute function public.trg_sync_goal_from_module();

create or replace function public.trg_sync_goal_from_subject()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.sync_goal(new.goal_id);
  return null;
end; $$;
create trigger learning_subjects_sync_goal after update of goal_id on public.learning_subjects
  for each row execute function public.trg_sync_goal_from_subject();

create or replace function public.trg_sync_goal_from_milestone()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.sync_goal(new.goal_id);
  return null;
end; $$;
create trigger goal_milestones_sync after insert on public.goal_milestones
  for each row execute function public.trg_sync_goal_from_milestone();

-- Posisi terakhir pada sumber belajar mengikuti sesi terbaru yang mencatat posisi.
create or replace function public.trg_session_updates_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_id is not null and new.position <> '' then
    update public.learning_sources set position = new.position where id = new.source_id;
  end if;
  return null;
end; $$;
create trigger learning_sessions_update_source after insert on public.learning_sessions
  for each row execute function public.trg_session_updates_source();

-- Fungsi trigger tidak boleh dipanggil langsung lewat API.
revoke execute on function public.trg_sync_goal_from_event() from public, anon, authenticated;
revoke execute on function public.trg_sync_goal_from_task() from public, anon, authenticated;
revoke execute on function public.trg_sync_goal_from_module() from public, anon, authenticated;
revoke execute on function public.trg_sync_goal_from_subject() from public, anon, authenticated;
revoke execute on function public.trg_sync_goal_from_milestone() from public, anon, authenticated;
revoke execute on function public.trg_session_updates_source() from public, anon, authenticated;
revoke execute on function public.tasks_track_completion() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_goal(uuid) from public, anon;
grant execute on function public.sync_goal(uuid) to authenticated;

-- =====================================================================
-- Row Level Security: setiap pengguna hanya melihat & mengubah datanya sendiri
-- =====================================================================
alter table public.profiles enable row level security;
create policy "profil milik sendiri: baca" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profil milik sendiri: ubah" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'goals', 'goal_milestones', 'goal_progress_events', 'projects',
    'learning_subjects', 'learning_sources', 'learning_modules', 'learning_sessions',
    'tasks', 'task_subtasks', 'journal_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "milik sendiri: baca" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: tambah" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: ubah" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: hapus" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke all on public.profiles from anon;
revoke all on public.goal_progress from anon;
