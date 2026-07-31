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
