-- Development project only. Run AFTER research.sql in the SQL Editor.
-- All fixture users, annotations, and history are rolled back.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-a000-000000000001','research-test-a@example.invalid'),
 ('00000000-0000-4000-a000-000000000002','research-test-b@example.invalid'),
 ('00000000-0000-4000-a000-000000000003','research-test-outsider@example.invalid');
insert into public.researchers(user_id,display_name) values
 ('00000000-0000-4000-a000-000000000001','Research test A'),
 ('00000000-0000-4000-a000-000000000002','Research test B');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000001';
select public.save_research_annotation('research-test-post-1','הערות מחקר',array[' educational ','Educational','Spiritual but not Religious'],0);
do $$ begin
  if (select tags from public.research_annotations where post_key='research-test-post-1') <> array['educational','Spiritual but not Religious'] then
    raise exception 'FAIL: phrase tags, canonicalization or deduplication';
  end if;
  begin
    insert into public.research_annotations(post_key,updated_by,updated_by_name) values('forbidden',auth.uid(),'spoof');
    raise exception 'FAIL: direct writes allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000002';
select public.save_research_annotation('research-test-post-1','Shared revision',array['educational','promotional'],1);
do $$ begin
  begin
    perform public.save_research_annotation('research-test-post-1','stale overwrite',array['educational'],1);
    raise exception 'FAIL: stale save was accepted';
  exception when serialization_failure then null; end;
  if (select updated_by_name from public.research_annotations where post_key='research-test-post-1') <> 'Research test B' then
    raise exception 'FAIL: author attribution';
  end if;
  if (select count(*) from public.research_annotation_history where post_key='research-test-post-1') <> 2 then
    raise exception 'FAIL: history does not match successful writes';
  end if;
  begin
    update public.research_annotation_history set notes='tampered' where post_key='research-test-post-1';
    raise exception 'FAIL: history can be modified';
  exception when insufficient_privilege then null; end;
end $$;
select public.save_research_annotation('research-test-post-2','Other post',array['educational'],0);
select public.rename_research_tag('educational','promotional');
do $$ begin
  if (select tags from public.research_annotations where post_key='research-test-post-1') <> array['promotional'] then
    raise exception 'FAIL: merging creates duplicate tags';
  end if;
  if (select version from public.research_annotations where post_key='research-test-post-1') <> 3 then
    raise exception 'FAIL: tag merge not versioned';
  end if;
  if (select tags from public.research_annotations where post_key='research-test-post-2') <> array['promotional'] then
    raise exception 'FAIL: rename did not affect every matching post';
  end if;
end $$;
-- Restore a historical snapshot as a new, attributed revision.
select public.save_research_annotation('research-test-post-1',h.notes,h.tags,3)
  from public.research_annotation_history h where h.post_key='research-test-post-1' and h.version=1;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000003';
do $$ begin
  if exists(select 1 from public.research_annotations) or exists(select 1 from public.research_annotation_history) then
    raise exception 'FAIL: outsider can read research data';
  end if;
  begin
    perform public.save_research_annotation('research-test-post-1','outsider',array['attack'],4);
    raise exception 'FAIL: outsider can save';
  exception when insufficient_privilege then null; end;
  begin
    perform public.rename_research_tag('promotional','attack');
    raise exception 'FAIL: outsider can rename tags';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.research_annotations;
    raise exception 'FAIL: public can read research data';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_research_annotation('research-test-post-1','anonymous',array['attack'],4);
    raise exception 'FAIL: anonymous RPC access';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: research permission, versioning, history, restore and tag-management checks' as result;
