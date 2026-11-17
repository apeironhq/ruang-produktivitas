-- =====================================================================
-- Asisten AI (Gemini) — kunci API milik masing-masing pengguna.
--
--  * ai_settings: status aktif + 4 karakter terakhir kunci (untuk ditampilkan).
--    Kuncinya sendiri disimpan terenkripsi di Supabase Vault (vault.secrets), tidak pernah
--    bisa dibaca dari browser — pengguna hanya bisa menyimpan / mengganti / menghapusnya.
--  * ai_save_key / ai_delete_key / ai_set_enabled: dipanggil pengguna yang masuk (auth.uid()).
--  * ai_get_key: hanya server (service role), dipakai bot saat memanggil Gemini.
-- =====================================================================
create table public.ai_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  key_secret_id uuid,
  key_hint text not null default '' check (char_length(key_hint) <= 8),
  updated_at timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
create policy "ai sendiri: baca" on public.ai_settings for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.ai_settings from anon, authenticated;
revoke all on public.ai_settings from anon;

-- Simpan / ganti kunci (sekaligus mengaktifkan asisten).
create function public.ai_save_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_\-]{20,200}$' then raise exception 'Format kunci tidak valid' using errcode = '22023'; end if;
  select s.key_secret_id into sid from public.ai_settings s where s.user_id = uid;
  if sid is not null and exists (select 1 from vault.secrets v where v.id = sid) then
    perform vault.update_secret(sid, p_key);
  else
    delete from vault.secrets v where v.name = 'ai_gemini_' || uid::text;
    sid := vault.create_secret(p_key, 'ai_gemini_' || uid::text, 'Kunci Gemini milik pengguna (Asisten AI)');
  end if;
  insert into public.ai_settings (user_id, enabled, key_secret_id, key_hint, updated_at)
  values (uid, true, sid, right(p_key, 4), now())
  on conflict (user_id) do update set enabled = true, key_secret_id = excluded.key_secret_id, key_hint = excluded.key_hint, updated_at = now();
end;
$$;

-- Hapus kunci (asisten otomatis nonaktif).
create function public.ai_delete_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Belum masuk' using errcode = '42501'; end if;
  delete from vault.secrets v where v.id = (select s.key_secret_id from public.ai_settings s where s.user_id = uid);
  delete from vault.secrets v where v.name = 'ai_gemini_' || uid::text;
  delete from public.ai_settings s where s.user_id = uid;
end;
$$;

-- Nyalakan / matikan tanpa menghapus kunci.
create function public.ai_set_enabled(p_on boolean)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.ai_settings s set enabled = p_on, updated_at = now()
  where s.user_id = auth.uid() and s.key_secret_id is not null
  returning s.enabled;
$$;

-- Ambil kunci (hanya server).
create function public.ai_get_key(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select d.decrypted_secret from public.ai_settings s
  join vault.decrypted_secrets d on d.id = s.key_secret_id
  where s.user_id = p_user and s.enabled;
$$;

revoke execute on function public.ai_save_key(text), public.ai_delete_key(), public.ai_set_enabled(boolean), public.ai_get_key(uuid) from public, anon;
grant execute on function public.ai_save_key(text), public.ai_delete_key(), public.ai_set_enabled(boolean) to authenticated;
revoke execute on function public.ai_get_key(uuid) from authenticated;
grant execute on function public.ai_get_key(uuid) to service_role;
