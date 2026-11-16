-- =====================================================================
-- Ruang Produktivitas — Tahap 2: Proyek Saya (PY-01 … PY-03)
-- Tabel projects sudah ada sejak Tahap 1. Di sini ditambah tahapan proyek.
-- Progres proyek dihitung dari tugas tertaut (bila ada) atau dari tahapan.
-- =====================================================================

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index project_milestones_project_idx on public.project_milestones (project_id, sort_order);
create index project_milestones_user_idx on public.project_milestones (user_id);

alter table public.project_milestones enable row level security;
create policy "milik sendiri: baca" on public.project_milestones for select to authenticated using (user_id = (select auth.uid()));
create policy "milik sendiri: tambah" on public.project_milestones for insert to authenticated with check (user_id = (select auth.uid()));
create policy "milik sendiri: ubah" on public.project_milestones for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "milik sendiri: hapus" on public.project_milestones for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.project_milestones from anon;

-- Tanggal selesai proyek tidak boleh sebelum tanggal mulai.
alter table public.projects add constraint projects_due_after_start check (due_date is null or start_date is null or due_date >= start_date);
