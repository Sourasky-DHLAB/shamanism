-- Run once in the Supabase SQL Editor as the project owner.
begin;
create table public.researchers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0)
);
create table public.research_annotations (
  post_key text primary key check (length(post_key) between 1 and 200),
  notes text not null default '' check (length(notes) <= 100000),
  tags text[] not null default '{}',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_by_name text not null
);
create table public.research_annotation_history (
  post_key text not null,
  version integer not null,
  notes text not null,
  tags text[] not null,
  updated_at timestamptz not null,
  updated_by uuid not null,
  updated_by_name text not null,
  primary key (post_key, version)
);
alter table public.researchers enable row level security;
alter table public.research_annotations enable row level security;
alter table public.research_annotation_history enable row level security;
revoke all on public.researchers, public.research_annotations, public.research_annotation_history from public, anon, authenticated;
grant select on public.researchers, public.research_annotations, public.research_annotation_history to authenticated;
create policy researcher_self on public.researchers for select to authenticated using (user_id = (select auth.uid()));
create policy team_reads_annotations on public.research_annotations for select to authenticated
  using (exists (select 1 from public.researchers where user_id = (select auth.uid())));
create policy team_reads_history on public.research_annotation_history for select to authenticated
  using (exists (select 1 from public.researchers where user_id = (select auth.uid())));

-- All writes use checked RPCs. Direct writes and history modification are denied.
create function public.record_research_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor_name text;
begin
  select display_name into actor_name from public.researchers where user_id = auth.uid();
  if actor_name is null then raise exception 'Researcher access required' using errcode = '42501'; end if;
  new.updated_by := auth.uid();
  new.updated_by_name := actor_name;
  new.updated_at := clock_timestamp();
  new.version := case when tg_op = 'INSERT' then 1 else old.version + 1 end;
  insert into public.research_annotation_history(post_key,version,notes,tags,updated_at,updated_by,updated_by_name)
    values(new.post_key,new.version,new.notes,new.tags,new.updated_at,new.updated_by,new.updated_by_name);
  return new;
end $$;
revoke all on function public.record_research_revision() from public, anon, authenticated;
create trigger research_revision before insert or update on public.research_annotations
  for each row execute function public.record_research_revision();

create function public.save_research_annotation(p_post_key text, p_notes text, p_tags text[], p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_row public.research_annotations; clean_tags text[]; actor_name text;
begin
  select display_name into actor_name from public.researchers where user_id = auth.uid();
  if actor_name is null then raise exception 'Researcher access required' using errcode = '42501'; end if;
  if p_post_key is null or length(p_post_key) not between 1 and 200 or p_notes is null or length(p_notes)>100000
     or p_expected_version is null or p_expected_version<0 or p_tags is null or cardinality(p_tags)>50 then
    raise exception 'Invalid annotation: up to 50 tags and 100000 note characters are allowed' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(p_tags) t where t is null or length(btrim(regexp_replace(t, '\s+', ' ', 'g'))) not between 1 and 120) then
    raise exception 'Tags must contain between 1 and 120 characters' using errcode = '22023';
  end if;
  -- Shared lock also serializes tag renames with saves and first-time inserts.
  perform pg_catalog.pg_advisory_xact_lock(8264091);
  select * into current_row from public.research_annotations where post_key=p_post_key;
  if coalesce(current_row.version,0) <> p_expected_version then
    raise exception 'Another researcher changed this post. Review the latest revision before saving.' using errcode='40001';
  end if;
  -- Reuse the team's existing spelling and deduplicate case-insensitively.
  select coalesce(array_agg(label order by lower(label)), '{}') into clean_tags from (
    select distinct on(lower(input.label)) coalesce(known.label,input.label) label
    from (select btrim(regexp_replace(t, '\s+', ' ', 'g')) label from unnest(p_tags) t) input
    left join lateral (
      select tag label from public.research_annotations a cross join lateral unnest(a.tags) tag
      where lower(tag)=lower(input.label) order by tag limit 1
    ) known on true order by lower(input.label), input.label
  ) labels;
  if current_row.version is null then
    insert into public.research_annotations(post_key,notes,tags,updated_by,updated_by_name)
      values(p_post_key,p_notes,clean_tags,auth.uid(),actor_name) returning * into current_row;
  else
    update public.research_annotations set notes=p_notes,tags=clean_tags where post_key=p_post_key returning * into current_row;
  end if;
  return to_jsonb(current_row);
end $$;
revoke all on function public.save_research_annotation(text,text,text[],integer) from public, anon, authenticated;
grant execute on function public.save_research_annotation(text,text,text[],integer) to authenticated;

create function public.rename_research_tag(p_from text, p_to text) returns integer
language plpgsql security definer set search_path = '' as $$
declare new_label text; changed integer;
begin
  if not exists(select 1 from public.researchers where user_id=auth.uid()) then
    raise exception 'Researcher access required' using errcode='42501';
  end if;
  new_label := btrim(regexp_replace(p_to, '\s+', ' ', 'g'));
  if new_label is null or length(new_label) not between 1 and 120 or p_from is null or btrim(p_from)='' then
    raise exception 'A tag must contain between 1 and 120 characters' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(8264091);
  -- Renaming into an existing tag merges assignments, preserving its spelling.
  select coalesce((select tag from public.research_annotations a cross join lateral unnest(a.tags) tag
    where lower(tag)=lower(new_label) and lower(tag)<>lower(p_from) order by tag limit 1),new_label) into new_label;
  update public.research_annotations a set tags=(
    select array_agg(tag order by lower(tag)) from (
      select distinct on(lower(label)) label tag from (
        select case when lower(t)=lower(p_from) then new_label else t end label from unnest(a.tags) t
      ) replaced order by lower(label),label
    ) dedup
  ) where exists(select 1 from unnest(a.tags) t where lower(t)=lower(p_from));
  get diagnostics changed = row_count;
  return changed;
end $$;
revoke all on function public.rename_research_tag(text,text) from public, anon, authenticated;
grant execute on function public.rename_research_tag(text,text) to authenticated;
commit;
