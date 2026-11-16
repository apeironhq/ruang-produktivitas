-- =====================================================================
-- Ruang Produktivitas — Tahap 2: Keuangan (KU-01 … KU-07)
-- Rekening/dompet, kategori, transaksi (pemasukan, pengeluaran, transfer),
-- anggaran bulanan, dan alokasi dana ke target tabungan.
--
-- Aturan PRD §6.7:
--  * Nominal memakai numeric(18,2), bukan angka pecahan biner.
--  * Transfer = dua mutasi bertaut (transfer_keluar + transfer_masuk) dengan
--    transfer_group_id yang sama → tidak menambah pemasukan/pengeluaran.
--  * Alokasi ke target BUKAN pemasukan baru: dana tetap di rekening, hanya
--    ditandai untuk target. Progres target "alokasi" dihitung dari sini.
--  * Saldo tidak disimpan; dihitung oleh view account_balances dari transaksi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Rekening / dompet
-- ---------------------------------------------------------------------
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'bank' check (kind in ('tunai', 'bank', 'dompet_digital', 'lainnya')),
  opening_balance numeric(18, 2) not null default 0,
  currency text not null default 'IDR' check (currency = 'IDR'),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index financial_accounts_user_idx on public.financial_accounts (user_id, is_archived);
create trigger financial_accounts_updated_at before update on public.financial_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Kategori transaksi
-- ---------------------------------------------------------------------
create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('pemasukan', 'pengeluaran')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, type, name)
);
create index transaction_categories_user_idx on public.transaction_categories (user_id, type);

-- ---------------------------------------------------------------------
-- Transaksi
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  type text not null check (type in ('pemasukan', 'pengeluaran', 'transfer_keluar', 'transfer_masuk')),
  amount numeric(18, 2) not null check (amount > 0 and amount < 1e15),
  category_id uuid,
  occurred_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 500),
  transfer_group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- transfer wajib punya pasangan & tanpa kategori; pemasukan/pengeluaran bukan bagian transfer
  constraint transactions_transfer_shape check (
    (type in ('transfer_keluar', 'transfer_masuk') and transfer_group_id is not null and category_id is null)
    or (type in ('pemasukan', 'pengeluaran') and transfer_group_id is null)
  ),
  foreign key (account_id, user_id) references public.financial_accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete set null (category_id)
);
create index transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index transactions_account_idx on public.transactions (account_id, occurred_on desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_group_idx on public.transactions (transfer_group_id) where transfer_group_id is not null;
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- Kategori harus sejenis dengan transaksinya (kategori pengeluaran tidak dipakai untuk pemasukan).
create or replace function public.transactions_check_category()
returns trigger language plpgsql set search_path = '' as $$
declare v_type text;
begin
  if new.category_id is not null then
    select type into v_type from public.transaction_categories where id = new.category_id;
    if v_type is distinct from new.type then
      raise exception 'Kategori tidak sesuai jenis transaksi' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger transactions_category_type before insert or update of category_id, type on public.transactions
  for each row execute function public.transactions_check_category();

-- Simpan transfer secara atomik: hapus pasangan lama (bila mengubah) lalu buat keluar+masuk baru.
create or replace function public.save_transfer(
  p_group uuid, p_from uuid, p_to uuid, p_amount numeric, p_date date, p_note text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_group uuid := coalesce(p_group, gen_random_uuid());
begin
  if p_from = p_to then
    raise exception 'Rekening asal dan tujuan harus berbeda' using errcode = '23514';
  end if;
  if p_group is not null then
    delete from public.transactions where transfer_group_id = p_group;
  end if;
  insert into public.transactions (account_id, type, amount, occurred_on, note, transfer_group_id)
  values (p_from, 'transfer_keluar', p_amount, p_date, coalesce(p_note, ''), v_group),
         (p_to, 'transfer_masuk', p_amount, p_date, coalesce(p_note, ''), v_group);
  return v_group;
end; $$;
revoke execute on function public.save_transfer(uuid, uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.save_transfer(uuid, uuid, uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- Anggaran bulanan per kategori pengeluaran
-- ---------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  limit_amount numeric(18, 2) not null check (limit_amount > 0 and limit_amount < 1e15),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month),
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete cascade
);
create index budgets_user_month_idx on public.budgets (user_id, month);
create index budgets_category_idx on public.budgets (category_id);
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Alokasi dana ke target tabungan (positif = alokasikan, negatif = tarik kembali)
-- ---------------------------------------------------------------------
create table public.goal_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  account_id uuid not null,
  amount numeric(18, 2) not null check (amount <> 0 and abs(amount) < 1e15),
  occurred_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.financial_accounts (id, user_id) on delete cascade
);
create index goal_allocations_goal_idx on public.goal_allocations (goal_id, occurred_on desc);
create index goal_allocations_account_idx on public.goal_allocations (account_id);
create index goal_allocations_user_idx on public.goal_allocations (user_id);

-- ---------------------------------------------------------------------
-- Saldo rekening: dihitung dari transaksi (tidak pernah disimpan)
-- ---------------------------------------------------------------------
create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.opening_balance + coalesce(t.net, 0) as balance,
  coalesce(al.total, 0) as allocated
from public.financial_accounts a
left join lateral (
  select sum(case when x.type in ('pemasukan', 'transfer_masuk') then x.amount else -x.amount end) as net
  from public.transactions x
  where x.account_id = a.id
) t on true
left join lateral (
  select sum(g.amount) as total
  from public.goal_allocations g
  where g.account_id = a.id
) al on true;

-- ---------------------------------------------------------------------
-- Target bersumber "alokasi": progres = nilai awal + total alokasi
-- ---------------------------------------------------------------------
alter table public.goals drop constraint goals_progress_source_check;
alter table public.goals add constraint goals_progress_source_check
  check (progress_source in ('manual', 'modul', 'tugas', 'alokasi'));
alter table public.goals drop constraint goals_manual_range;
alter table public.goals add constraint goals_manual_range check (
  progress_source not in ('manual', 'alokasi')
  or (direction = 'naik' and target_value > start_value)
  or (direction = 'turun' and target_value < start_value)
);
alter table public.goals add constraint goals_alokasi_rupiah check (
  progress_source <> 'alokasi' or (metric_type = 'rupiah' and direction = 'naik')
);

create or replace view public.goal_progress
with (security_invoker = true)
as
select
  g.id as goal_id,
  g.user_id,
  case g.progress_source
    when 'manual' then g.start_value + coalesce(ev.total, 0)
    when 'alokasi' then g.start_value + coalesce(al.total, 0)
    when 'modul' then coalesce(md.done, 0)::numeric
    when 'tugas' then coalesce(tk.done, 0)::numeric
  end as current_value,
  case g.progress_source
    when 'modul' then coalesce(md.total, 0)::numeric
    when 'tugas' then coalesce(tk.total, 0)::numeric
    else g.target_value
  end as effective_target,
  case when g.progress_source in ('manual', 'alokasi') then g.start_value else 0::numeric end as effective_start,
  coalesce(md.total, tk.total, 0) as item_total,
  coalesce(md.done, tk.done, 0) as item_done
from public.goals g
left join lateral (
  select sum(e.value) as total from public.goal_progress_events e where e.goal_id = g.id
) ev on g.progress_source = 'manual'
left join lateral (
  select sum(a.amount) as total from public.goal_allocations a where a.goal_id = g.id
) al on g.progress_source = 'alokasi'
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

-- sync_goal: target "alokasi" diperlakukan seperti target nilai (manual).
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
  v_valued boolean;
begin
  if p_goal_id is null then
    return;
  end if;
  select * into v_goal from public.goals where id = p_goal_id;
  if not found then
    return;
  end if;
  v_valued := v_goal.progress_source in ('manual', 'alokasi');
  select current_value, effective_target, effective_start, item_total
    into v_cur, v_target, v_start, v_items
  from public.goal_progress where goal_id = p_goal_id;

  update public.goal_milestones m
     set reached_at = now()
   where m.goal_id = p_goal_id
     and m.reached_at is null
     and case when v_goal.direction = 'turun' and v_valued
              then v_cur <= m.threshold else v_cur >= m.threshold end;

  if v_goal.status = 'aktif'
     and (v_valued or v_items > 0)
     and public.progress_percent(v_cur, v_start, v_target) >= 100 then
    update public.goals
       set status = 'tercapai', achieved_at = now()
     where id = p_goal_id and status = 'aktif';
  end if;
end;
$$;

create or replace function public.trg_sync_goal_from_allocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.sync_goal(coalesce(new.goal_id, old.goal_id));
  return null;
end; $$;
create trigger goal_allocations_sync after insert or update or delete on public.goal_allocations
  for each row execute function public.trg_sync_goal_from_allocation();

revoke execute on function public.trg_sync_goal_from_allocation() from public, anon, authenticated;
revoke execute on function public.transactions_check_category() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Kategori bawaan: untuk akun baru (trigger) dan akun yang sudah ada
-- ---------------------------------------------------------------------
create or replace function public.seed_default_categories(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.transaction_categories (user_id, name, type)
  select p_user, c.name, c.type
  from (values
    ('Gaji', 'pemasukan'), ('Usaha', 'pemasukan'), ('Bonus & hadiah', 'pemasukan'), ('Lainnya', 'pemasukan'),
    ('Makan & minum', 'pengeluaran'), ('Transportasi', 'pengeluaran'), ('Belanja', 'pengeluaran'),
    ('Tagihan & utilitas', 'pengeluaran'), ('Pendidikan', 'pengeluaran'), ('Kesehatan', 'pengeluaran'),
    ('Hiburan', 'pengeluaran'), ('Sedekah & donasi', 'pengeluaran'), ('Lainnya', 'pengeluaran')
  ) as c(name, type)
  on conflict (user_id, type, name) do nothing;
$$;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

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
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

select public.seed_default_categories(p.id) from public.profiles p;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['financial_accounts', 'transaction_categories', 'transactions', 'budgets', 'goal_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "milik sendiri: baca" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: tambah" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: ubah" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "milik sendiri: hapus" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke all on public.account_balances from anon;
