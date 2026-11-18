-- =====================================================================
-- Asisten AI: ingatan percakapan + izin membaca ringkasan data.
--
--  * ai_chat_turns: beberapa pesan terakhir obrolan dengan Rupi AI (per chat Telegram),
--    dipakai sebagai konteks agar Rupi paham "yang tadi …". Hanya server (service role)
--    yang bisa membaca / menulis; baris lama dihapus oleh bot (disimpan maks. ±1 hari).
--  * ai_settings.share_data: bila aktif, ringkasan data pengguna (agenda, tugas, target,
--    keuangan bulan ini) ikut dikirim ke penyedia AI pilihan pengguna agar Rupi bisa
--    menjawab pertanyaan seperti "tugasku hari ini apa?".
--  * ai_get_config: kini juga mengembalikan share_data.
-- =====================================================================
create table public.ai_chat_turns (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id bigint not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index ai_chat_turns_chat_idx on public.ai_chat_turns (chat_id, created_at desc);
create index ai_chat_turns_user_idx on public.ai_chat_turns (user_id);
alter table public.ai_chat_turns enable row level security;
-- Tanpa kebijakan: anon / authenticated tidak bisa membaca atau menulis sama sekali.
revoke all on public.ai_chat_turns from anon, authenticated;

alter table public.ai_settings add column share_data boolean not null default true;

-- Nyalakan / matikan izin membaca ringkasan data (milik sendiri).
create function public.ai_set_share_data(p_on boolean)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.ai_settings s set share_data = p_on, updated_at = now()
  where s.user_id = auth.uid()
  returning s.share_data;
$$;

-- Bentuk hasil berubah → buat ulang.
drop function public.ai_get_config(uuid);
create function public.ai_get_config(p_user uuid)
returns table (key text, base_url text, model text, share_data boolean)
language sql
security definer
set search_path = ''
as $$
  select d.decrypted_secret, s.base_url, s.model, s.share_data from public.ai_settings s
  join vault.decrypted_secrets d on d.id = s.key_secret_id
  where s.user_id = p_user and s.enabled;
$$;

revoke execute on function public.ai_set_share_data(boolean), public.ai_get_config(uuid) from public, anon;
grant execute on function public.ai_set_share_data(boolean) to authenticated;
revoke execute on function public.ai_get_config(uuid) from authenticated;
grant execute on function public.ai_get_config(uuid) to service_role;
