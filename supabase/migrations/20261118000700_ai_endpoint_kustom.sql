-- =====================================================================
-- Asisten AI: endpoint kustom (API kompatibel OpenAI, mis. 9router).
--
--  * ai_settings.base_url / model: kosong = Groq bawaan; terisi = endpoint kustom
--    (alamat HTTPS publik + nama model atau combo di endpoint tsb).
--  * ai_save_endpoint: simpan kunci + alamat + model sekaligus (kunci tetap di Vault).
--  * ai_save_key (Groq): mengosongkan base_url / model agar kembali ke Groq.
--  * ai_get_config: hanya server — kunci + alamat + model untuk bot.
-- =====================================================================
alter table public.ai_settings
  add column base_url text not null default '' check (char_length(base_url) <= 300 and (base_url = '' or base_url ~ '^https://')),
  add column model text not null default '' check (char_length(model) <= 120);

-- Groq: sama seperti sebelumnya, ditambah kembali ke Groq (alamat & model dikosongkan).
create or replace function public.ai_save_key(p_key text)
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
  if p_key is null or char_length(p_key) not between 20 and 300 or p_key !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Format kunci tidak valid' using errcode = '22023';
  end if;
  select s.key_secret_id into sid from public.ai_settings s where s.user_id = uid;
  if sid is not null and exists (select 1 from vault.secrets v where v.id = sid) then
    perform vault.update_secret(sid, p_key);
  else
    delete from vault.secrets v where v.name = 'ai_gemini_' || uid::text;
    sid := vault.create_secret(p_key, 'ai_gemini_' || uid::text, 'Kunci AI milik pengguna (Asisten AI)');
  end if;
  insert into public.ai_settings (user_id, enabled, key_secret_id, key_hint, base_url, model, updated_at)
  values (uid, true, sid, right(p_key, 4), '', '', now())
  on conflict (user_id) do update set enabled = true, key_secret_id = excluded.key_secret_id, key_hint = excluded.key_hint,
    base_url = '', model = '', updated_at = now();
end;
$$;

-- Endpoint kustom: kunci (8–300 karakter) + alamat HTTPS + nama model/combo.
-- Pemeriksaan "alamat publik" (bukan localhost / jaringan privat) dilakukan server sebelum memanggil fungsi ini.
create function public.ai_save_endpoint(p_key text, p_base_url text, p_model text)
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
  if p_key is null or char_length(p_key) not between 8 and 300 or p_key !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Format kunci tidak valid' using errcode = '22023';
  end if;
  if p_base_url is null or char_length(p_base_url) > 300 or p_base_url !~ '^https://[^\s/?#]+(/[^\s?#]*)?$' then
    raise exception 'Alamat endpoint tidak valid' using errcode = '22023';
  end if;
  if p_model is null or char_length(p_model) not between 1 and 120 or p_model !~ '^[A-Za-z0-9._:/@+-]+$' then
    raise exception 'Nama model tidak valid' using errcode = '22023';
  end if;
  select s.key_secret_id into sid from public.ai_settings s where s.user_id = uid;
  if sid is not null and exists (select 1 from vault.secrets v where v.id = sid) then
    perform vault.update_secret(sid, p_key);
  else
    delete from vault.secrets v where v.name = 'ai_gemini_' || uid::text;
    sid := vault.create_secret(p_key, 'ai_gemini_' || uid::text, 'Kunci AI milik pengguna (Asisten AI)');
  end if;
  insert into public.ai_settings (user_id, enabled, key_secret_id, key_hint, base_url, model, updated_at)
  values (uid, true, sid, right(p_key, 4), p_base_url, p_model, now())
  on conflict (user_id) do update set enabled = true, key_secret_id = excluded.key_secret_id, key_hint = excluded.key_hint,
    base_url = excluded.base_url, model = excluded.model, updated_at = now();
end;
$$;

-- Konfigurasi lengkap untuk bot (hanya server).
create function public.ai_get_config(p_user uuid)
returns table (key text, base_url text, model text)
language sql
security definer
set search_path = ''
as $$
  select d.decrypted_secret, s.base_url, s.model from public.ai_settings s
  join vault.decrypted_secrets d on d.id = s.key_secret_id
  where s.user_id = p_user and s.enabled;
$$;

revoke execute on function public.ai_save_key(text), public.ai_save_endpoint(text, text, text), public.ai_get_config(uuid) from public, anon;
grant execute on function public.ai_save_key(text), public.ai_save_endpoint(text, text, text) to authenticated;
revoke execute on function public.ai_get_config(uuid) from authenticated;
grant execute on function public.ai_get_config(uuid) to service_role;
