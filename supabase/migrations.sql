-- ============================================================
-- Полная схема мессенджера. Запусти в новом Postgres,
-- если будешь переезжать со Supabase.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
create index if not exists profiles_username_idx on public.profiles (lower(username));

create table if not exists public.contacts (
  id bigserial primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, contact_id)
);
create index if not exists contacts_owner_idx on public.contacts (owner_id);

do $$ begin
  create type message_kind as enum ('text', 'image', 'video', 'voice');
exception when duplicate_object then null; end $$;

create table if not exists public.messages (
  id bigserial primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind message_kind not null default 'text',
  content text,
  media_url text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists messages_pair_idx on public.messages (
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at desc
);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);

do $$ begin
  create type call_type as enum ('audio', 'video');
  create type call_status as enum ('ringing', 'active', 'ended', 'missed', 'declined');
exception when duplicate_object then null; end $$;

create table if not exists public.calls (
  id bigserial primary key,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  type call_type not null,
  status call_status not null default 'ringing',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists calls_callee_idx on public.calls (callee_id, status, started_at desc);

create table if not exists public.call_signals (
  id bigserial primary key,
  call_id bigint not null references public.calls(id) on delete cascade,
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_to_idx on public.call_signals (to_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.call_signals enable row level security;

drop policy if exists profiles_read_all on public.profiles;
drop policy if exists profiles_read_authenticated on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);

drop policy if exists contacts_read_own on public.contacts;
drop policy if exists contacts_insert_own on public.contacts;
drop policy if exists contacts_delete_own on public.contacts;
create policy contacts_read_own on public.contacts for select using (auth.uid() = owner_id);
create policy contacts_insert_own on public.contacts for insert with check (auth.uid() = owner_id);
create policy contacts_delete_own on public.contacts for delete using (auth.uid() = owner_id);

drop policy if exists messages_read_participant on public.messages;
drop policy if exists messages_insert_sender on public.messages;
create policy messages_read_participant on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);
create policy messages_insert_sender on public.messages for insert
  with check (auth.uid() = sender_id);

drop policy if exists calls_read_participant on public.calls;
drop policy if exists calls_insert_caller on public.calls;
drop policy if exists calls_update_participant on public.calls;
create policy calls_read_participant on public.calls for select
  using (auth.uid() = caller_id or auth.uid() = callee_id);
create policy calls_insert_caller on public.calls for insert
  with check (auth.uid() = caller_id);
create policy calls_update_participant on public.calls for update
  using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists signals_read_to on public.call_signals;
drop policy if exists signals_insert_from on public.call_signals;
create policy signals_read_to on public.call_signals for select using (auth.uid() = to_id);
create policy signals_insert_from on public.call_signals for insert with check (auth.uid() = from_id);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_signals;

-- Storage bucket для медиа
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media','media',true, 20971520,
  array['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime','video/webm','audio/wav','audio/webm','audio/mpeg','audio/ogg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "media_authenticated_upload" on storage.objects;
drop policy if exists "media_public_read" on storage.objects;
drop policy if exists "media_owner_delete" on storage.objects;
create policy "media_authenticated_upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "media_public_read" on storage.objects
  for select to public using (bucket_id = 'media');
create policy "media_owner_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and owner = auth.uid());

-- RPC: добавление взаимного контакта (обходит RLS через security definer)
create or replace function public.add_mutual_contact(target_username text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare target public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into target from public.profiles where lower(username) = lower(target_username) limit 1;
  if target.id is null then raise exception 'user not found'; end if;
  if target.id = auth.uid() then raise exception 'self'; end if;
  insert into public.contacts (owner_id, contact_id) values (auth.uid(), target.id) on conflict do nothing;
  insert into public.contacts (owner_id, contact_id) values (target.id, auth.uid()) on conflict do nothing;
  return target;
end; $$;
revoke all on function public.add_mutual_contact(text) from public;
grant execute on function public.add_mutual_contact(text) to authenticated;

-- Триггер: при первом сообщении автоматически создаём двустороннюю связь
create or replace function public.ensure_contact_pair()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.contacts (owner_id, contact_id) values (new.sender_id, new.recipient_id) on conflict do nothing;
  insert into public.contacts (owner_id, contact_id) values (new.recipient_id, new.sender_id) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists messages_ensure_contact on public.messages;
create trigger messages_ensure_contact after insert on public.messages
for each row execute function public.ensure_contact_pair();
