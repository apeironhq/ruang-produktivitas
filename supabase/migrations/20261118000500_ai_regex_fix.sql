-- =====================================================================
-- Asisten AI: perbaiki validasi kunci di ai_save_key.
-- Pola '{20,300}' melebihi batas pengulangan regex PostgreSQL (255) sehingga fungsi selalu gagal.
-- Panjang kini diperiksa terpisah dengan char_length.
-- =====================================================================
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
  insert into public.ai_settings (user_id, enabled, key_secret_id, key_hint, updated_at)
  values (uid, true, sid, right(p_key, 4), now())
  on conflict (user_id) do update set enabled = true, key_secret_id = excluded.key_secret_id, key_hint = excluded.key_hint, updated_at = now();
end;
$$;
revoke execute on function public.ai_save_key(text) from public, anon;
grant execute on function public.ai_save_key(text) to authenticated;
