-- Status "sudah dibaca" untuk notifikasi di lonceng header.
-- Notifikasi dihitung dari data (tugas terlambat, tenggat & kegiatan hari ini, lencana baru);
-- tabel ini hanya mencatat kunci notifikasi yang sudah ditandai dibaca oleh pemiliknya.
create table public.notification_reads (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 3 and 80),
  read_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index notification_reads_user_read_idx on public.notification_reads (user_id, read_at);

alter table public.notification_reads enable row level security;
create policy "dibaca sendiri: baca" on public.notification_reads for select to authenticated using (user_id = (select auth.uid()));
create policy "dibaca sendiri: tambah" on public.notification_reads for insert to authenticated with check (user_id = (select auth.uid()));
create policy "dibaca sendiri: ubah" on public.notification_reads for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dibaca sendiri: hapus" on public.notification_reads for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.notification_reads from anon;
