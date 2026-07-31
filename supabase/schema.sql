create extension if not exists pgcrypto;

create table if not exists public.worlds (
  id text primary key,
  user_id uuid,
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
set search_path = public
as $$
declare
  v_draft public.story_drafts%rowtype;
  v_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_world_id, 0));

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

  if v_draft.status not in ('proposed', 'revising') then
    raise exception '채택할 수 없는 초안입니다.';
  end if;

  select coalesce(max(s.sequence), 0) + 1 into v_sequence
  from public.story_scenes s
  where s.world_id = p_world_id;

  insert into public.story_scenes (
    id, world_id, draft_id, title, content, sequence, status, accepted_at,
    source_transcript_ids, related_canon_ids
  ) values (
    p_scene_id, p_world_id, v_draft.id, v_draft.title, v_draft.body, v_sequence,
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