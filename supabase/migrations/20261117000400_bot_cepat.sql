-- =====================================================================
-- Bot lebih cepat: satu panggilan database di awal setiap update Telegram.
--
-- bot_begin() sekaligus:
--   1. mencatat update_id (idempoten — update yang dikirim ulang ditandai duplikat),
--   2. mencari koneksi Telegram + profil pengguna (nama, zona waktu),
--   3. memperbarui chat_id bila berubah.
-- Sebelumnya 3–4 panggilan berurutan. Hanya untuk service role.
-- =====================================================================
create or replace function public.bot_begin(p_update_id bigint, p_telegram_user bigint, p_chat bigint)
returns table (duplicate boolean, user_id uuid, display_name text, timezone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
  v_user uuid;
  v_chat bigint;
begin
  insert into public.telegram_updates (update_id) values (p_update_id) on conflict (update_id) do nothing;
  get diagnostics v_new = row_count;
  if not v_new then
    return query select true, null::uuid, null::text, null::text;
    return;
  end if;
  if p_telegram_user is null then
    return query select false, null::uuid, null::text, null::text;
    return;
  end if;
  select c.user_id, c.chat_id into v_user, v_chat from public.telegram_connections c where c.telegram_user_id = p_telegram_user;
  if v_user is not null and p_chat is not null and v_chat is distinct from p_chat then
    update public.telegram_connections set chat_id = p_chat where telegram_connections.user_id = v_user;
  end if;
  return query
    select false, v_user, coalesce(p.display_name, ''), coalesce(p.timezone, 'Asia/Jakarta')
    from (select 1) one left join public.profiles p on p.id = v_user;
end;
$$;
revoke execute on function public.bot_begin(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.bot_begin(bigint, bigint, bigint) to service_role;
