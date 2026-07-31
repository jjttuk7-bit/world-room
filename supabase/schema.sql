create extension if not exists pgcrypto;

create table if not exists public.worlds (
  id text primary key,
  user_id uuid,
  owner_id uuid not null,
  title text not null,
  summary text not null default '',
  continuity_brief text not null default '',
  latest_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  owner_id uuid not null,
  title text not null,
  transcript jsonb not null default '[]'::jsonb,
  sparks jsonb not null default '[]'::jsonb,
  summary text not null default '',
  next_questions jsonb not null default '[]'::jsonb,
  model text not null,
  voice text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.canon_cards (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  owner_id uuid not null,
  type text not null check (type in ('setting', 'character', 'conflict', 'scene_hook')),
  title text not null,
  content text not null,
  source_session_id text references public.sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'worlds_latest_session_fk'
  ) then
    alter table public.worlds
      add constraint worlds_latest_session_fk
      foreign key (latest_session_id)
      references public.sessions(id)
      on delete set null;
  end if;
end
$$;

create index if not exists worlds_updated_at_idx on public.worlds(updated_at desc);
create index if not exists sessions_world_id_created_at_idx on public.sessions(world_id, created_at desc);
create index if not exists canon_cards_world_id_type_idx on public.canon_cards(world_id, type);

-- Private writer studio: every draft and manuscript scene belongs to one world.
create table if not exists public.story_drafts (
  id text primary key,
  world_id text not null,
  owner_id uuid not null,
  session_id text references public.sessions(id) on delete set null,
  title text not null,
  body text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'revising', 'held', 'accepted', 'superseded')),
  source_transcript_ids jsonb not null default '[]'::jsonb,
  related_canon_ids jsonb not null default '[]'::jsonb,
  parent_draft_id text,
  created_at timestamptz not null default now(),
  unique (id, world_id),
  foreign key (world_id) references public.worlds(id) on delete cascade,
  foreign key (parent_draft_id, world_id)
    references public.story_drafts(id, world_id)
    on delete set null (parent_draft_id)
);

create table if not exists public.story_scenes (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  owner_id uuid not null,
  draft_id text not null,
  title text not null,
  content text not null,
  sequence integer not null check (sequence > 0),
  status text not null default 'accepted' check (status = 'accepted'),
  accepted_at timestamptz not null default now(),
  source_transcript_ids jsonb not null default '[]'::jsonb,
  related_canon_ids jsonb not null default '[]'::jsonb,
  unique (draft_id),
  unique (world_id, sequence),
  foreign key (draft_id, world_id)
    references public.story_drafts(id, world_id)
    on delete cascade
);

create index if not exists story_drafts_world_id_created_at_idx
  on public.story_drafts(world_id, created_at desc);
create index if not exists story_scenes_world_id_sequence_idx
  on public.story_scenes(world_id, sequence);

-- Accepting a draft is one transaction: it serializes a world's sequence,
-- creates the scene, and updates the draft lifecycle together.
create or replace function public.accept_story_draft(
  p_world_id text,
  p_draft_id text,
  p_scene_id text,
  p_owner_id uuid,
  p_accepted_at timestamptz default now()
)
returns table (
  id text,
  world_id text,
  draft_id text,
  title text,
  content text,
  sequence integer,
  accepted_at timestamptz,
  source_transcript_ids jsonb,
  related_canon_ids jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_draft public.story_drafts%rowtype;
  v_owner_id uuid;
  v_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_world_id, 0));

  select owner_id into v_owner_id
  from public.worlds
  where id = p_world_id
  for update;

  if not found or v_owner_id <> p_owner_id then
    raise exception '해당 세계에 접근할 수 없습니다.';
  end if;

  select * into v_draft
  from public.story_drafts
  where id = p_draft_id and world_id = p_world_id
  for update;

  if not found then
    raise exception '채택할 초안을 찾을 수 없습니다.';
  end if;

  if v_draft.status = 'accepted' then
    raise exception '이미 채택된 초안입니다.';
  end if;

  if v_draft.status <> 'proposed' then
    raise exception '채택할 수 없는 초안입니다.';
  end if;

  select coalesce(max(s.sequence), 0) + 1 into v_sequence
  from public.story_scenes s
  where s.world_id = p_world_id;

  insert into public.story_scenes (
    id, world_id, owner_id, draft_id, title, content, sequence, status, accepted_at,
    source_transcript_ids, related_canon_ids
  ) values (
    p_scene_id, p_world_id, v_owner_id, v_draft.id, v_draft.title, v_draft.body, v_sequence,
    'accepted', p_accepted_at, v_draft.source_transcript_ids, v_draft.related_canon_ids
  );

  update public.story_drafts
  set status = 'accepted'
  where id = v_draft.id and world_id = p_world_id;

  if v_draft.parent_draft_id is not null then
    update public.story_drafts
    set status = 'superseded'
    where id = v_draft.parent_draft_id
      and world_id = p_world_id
      and status = 'revising';
  end if;

  return query
  select s.id, s.world_id, s.draft_id, s.title, s.content, s.sequence,
         s.accepted_at, s.source_transcript_ids, s.related_canon_ids
  from public.story_scenes s
  where s.id = p_scene_id;
end;
$$;
-- Ownership and database access are private by default. The application uses only
-- the server-side service-role client; browser clients get no table or RPC rights.
-- The fixed legacy UUID safely upgrades existing single-workspace rows. Production
-- servers should configure WORLD_ROOM_OWNER_ID to a distinct UUID per workspace.
alter table public.worlds add column if not exists owner_id uuid;
update public.worlds
set owner_id = coalesce(owner_id, user_id, '00000000-0000-0000-0000-000000000001'::uuid)
where owner_id is null;
alter table public.worlds alter column owner_id set not null;

alter table public.sessions add column if not exists owner_id uuid;
update public.sessions s
set owner_id = w.owner_id
from public.worlds w
where w.id = s.world_id and s.owner_id is null;
alter table public.sessions alter column owner_id set not null;

alter table public.canon_cards add column if not exists owner_id uuid;
update public.canon_cards c
set owner_id = w.owner_id
from public.worlds w
where w.id = c.world_id and c.owner_id is null;
alter table public.canon_cards alter column owner_id set not null;

alter table public.story_drafts add column if not exists owner_id uuid;
update public.story_drafts d
set owner_id = w.owner_id
from public.worlds w
where w.id = d.world_id and d.owner_id is null;
alter table public.story_drafts alter column owner_id set not null;

alter table public.story_scenes add column if not exists owner_id uuid;
update public.story_scenes s
set owner_id = w.owner_id
from public.worlds w
where w.id = s.world_id and s.owner_id is null;
alter table public.story_scenes alter column owner_id set not null;

create or replace function public.revise_story_draft(
  p_world_id text,
  p_parent_draft_id text,
  p_revision_id text,
  p_title text,
  p_body text,
  p_owner_id uuid,
  p_created_at timestamptz default now()
)
returns table (
  id text,
  world_id text,
  session_id text,
  title text,
  body text,
  status text,
  source_transcript_ids jsonb,
  related_canon_ids jsonb,
  parent_draft_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.story_drafts%rowtype;
  v_owner_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_world_id, 0));

  select owner_id into v_owner_id
  from public.worlds
  where id = p_world_id
  for update;

  if not found or v_owner_id <> p_owner_id then
    raise exception '해당 세계에 접근할 수 없습니다.';
  end if;

  select * into v_parent
  from public.story_drafts
  where id = p_parent_draft_id and world_id = p_world_id
  for update;

  if not found then
    raise exception '수정할 초안을 찾을 수 없습니다.';
  end if;

  if v_parent.status not in ('proposed', 'held') then
    raise exception '수정할 수 없는 초안입니다.';
  end if;

  if exists (
    select 1
    from public.story_drafts child
    where child.world_id = p_world_id
      and child.parent_draft_id = v_parent.id
  ) then
    raise exception '이미 진행 중인 수정본이 있습니다.';
  end if;

  update public.story_drafts
  set status = 'revising'
  where id = v_parent.id and world_id = p_world_id;

  insert into public.story_drafts (
    id, world_id, owner_id, session_id, title, body, status,
    source_transcript_ids, related_canon_ids, parent_draft_id, created_at
  ) values (
    p_revision_id, v_parent.world_id, v_owner_id, v_parent.session_id,
    p_title, p_body, 'proposed', v_parent.source_transcript_ids,
    v_parent.related_canon_ids, v_parent.id, p_created_at
  );

  return query
  select d.id, d.world_id, d.session_id, d.title, d.body, d.status,
         d.source_transcript_ids, d.related_canon_ids, d.parent_draft_id, d.created_at
  from public.story_drafts d
  where d.id = p_revision_id and d.world_id = p_world_id;
end;
$$;

-- RLS policies are intentionally absent: direct anon/authenticated access is
-- denied. The Vercel server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
alter table public.worlds enable row level security;
alter table public.sessions enable row level security;
alter table public.canon_cards enable row level security;
alter table public.story_drafts enable row level security;
alter table public.story_scenes enable row level security;

revoke all on table public.worlds, public.sessions, public.canon_cards,
  public.story_drafts, public.story_scenes from public, anon, authenticated;
grant all on table public.worlds, public.sessions, public.canon_cards,
  public.story_drafts, public.story_scenes to service_role;

revoke all on function public.accept_story_draft(text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.revise_story_draft(text, text, text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_story_draft(text, text, text, uuid, timestamptz)
  to service_role;
grant execute on function public.revise_story_draft(text, text, text, text, text, uuid, timestamptz)
  to service_role;
-- Creative briefs are immutable world-local planning history. Only the most
-- recently approved brief remains active; activation is serialized per world.
create table if not exists public.creative_briefs (
  id text primary key,
  world_id text not null references public.worlds(id) on delete cascade,
  owner_id uuid not null,
  intent text not null,
  conflict text not null default '',
  tone text not null default '',
  required_elements jsonb not null default '[]'::jsonb,
  session_goal text not null default '',
  status text not null default 'active' check (status in ('active', 'historical')),
  created_at timestamptz not null default now()
);

create index if not exists creative_briefs_world_id_created_at_idx
  on public.creative_briefs(world_id, created_at desc);
create unique index if not exists creative_briefs_one_active_per_world_idx
  on public.creative_briefs(world_id)
  where status = 'active';

create or replace function public.activate_creative_brief(
  p_world_id text,
  p_brief_id text,
  p_owner_id uuid,
  p_intent text,
  p_conflict text,
  p_tone text,
  p_required_elements jsonb,
  p_session_goal text
)
returns table (
  id text,
  world_id text,
  intent text,
  conflict text,
  tone text,
  required_elements jsonb,
  session_goal text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_world_id, 0));

  select owner_id into v_owner_id
  from public.worlds
  where id = p_world_id
  for update;

  if not found or v_owner_id <> p_owner_id then
    raise exception '해당 세계에 접근할 수 없습니다.';
  end if;

  update public.creative_briefs
  set status = 'historical'
  where world_id = p_world_id
    and owner_id = v_owner_id
    and status = 'active';

  insert into public.creative_briefs (
    id, world_id, owner_id, intent, conflict, tone, required_elements,
    session_goal, status
  ) values (
    p_brief_id, p_world_id, v_owner_id, p_intent, p_conflict, p_tone,
    coalesce(p_required_elements, '[]'::jsonb), p_session_goal, 'active'
  );

  return query
  select b.id, b.world_id, b.intent, b.conflict, b.tone,
         b.required_elements, b.session_goal, b.status, b.created_at
  from public.creative_briefs b
  where b.id = p_brief_id and b.world_id = p_world_id;
end;
$$;

alter table public.creative_briefs enable row level security;
revoke all on table public.creative_briefs from public, anon, authenticated;
grant all on table public.creative_briefs to service_role;
revoke all on function public.activate_creative_brief(text, text, uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.activate_creative_brief(text, text, uuid, text, text, text, jsonb, text)
  to service_role;
