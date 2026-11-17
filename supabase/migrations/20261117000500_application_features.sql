begin;

create table public.daily_usage (
    bucket text not null,
    day date not null,
    units integer not null check (units >= 0),
    primary key (bucket, day)
);

alter table public.daily_usage enable row level security;
revoke all on public.daily_usage from public, anon, authenticated;
grant all on public.daily_usage to service_role;

create function public.charge_usage(
    global_bucket text, global_limit integer, unit_count integer,
    account_bucket text default null, account_limit integer default null
)
returns void language plpgsql set search_path = ''
as $$
declare
    today date := (now() at time zone 'UTC')::date;
begin
    if unit_count is null or unit_count <= 0 or global_limit is null or global_limit <= 0
       or (account_bucket is not null and (account_limit is null or account_limit <= 0)) then
        raise exception 'Invalid usage settings';
    end if;
    if unit_count > global_limit or (account_bucket is not null and unit_count > account_limit) then
        raise sqlstate 'PT429' using message = 'Daily limit reached';
    end if;

    insert into public.daily_usage as usage (bucket, day, units)
    values (global_bucket, today, unit_count)
    on conflict (bucket, day) do update set units = usage.units + excluded.units
    where usage.units <= global_limit - excluded.units;
    if not found then
        raise sqlstate 'PT429' using message = 'Daily limit reached';
    end if;

    if account_bucket is not null then
        insert into public.daily_usage as usage (bucket, day, units)
        values (account_bucket, today, unit_count)
        on conflict (bucket, day) do update set units = usage.units + excluded.units
        where usage.units <= account_limit - excluded.units;
        if not found then
            raise sqlstate 'PT429' using message = 'Daily limit reached';
        end if;
    end if;
end;
$$;

alter table public.chat_documents add column position integer not null default 0;
alter table public.messages add column turn_number integer not null default 0;
create unique index messages_turn_role_idx on public.messages (chat_id, turn_number, role)
    where turn_number > 0;

create function public.save_chat_turn(
    target_owner uuid, target_chat uuid, selected_documents uuid[],
    expected_turn integer, question_text text, answer_text text, answer_sources jsonb
)
returns uuid language plpgsql set search_path = ''
as $$
declare
    chat_id_value uuid;
    last_turn integer;
    chat_documents_value uuid[];
begin
    if selected_documents is null or cardinality(selected_documents) = 0
       or exists (
          select from unnest(selected_documents) as input(id)
          where not exists (
              select from public.documents
              where id = input.id and owner_id = target_owner and status = 'ready'
          )
       ) then
        raise sqlstate 'PT404' using message = 'Document not found';
    end if;

    if target_chat is null then
        insert into public.chats(owner_id, title)
        values (target_owner, left(question_text, 100))
        returning id into chat_id_value;

        insert into public.chat_documents(chat_id, document_id, position)
        select chat_id_value, input.id, (input.ordinality - 1)::integer
        from unnest(selected_documents) with ordinality as input(id, ordinality);
    else
        select id into chat_id_value from public.chats
        where id = target_chat and owner_id = target_owner
        for update;
        if not found then
            raise sqlstate 'PT404' using message = 'Chat not found';
        end if;

        select array_agg(link.document_id order by link.position, link.document_id)
        into chat_documents_value
        from public.chat_documents as link where link.chat_id = chat_id_value;
        if selected_documents is distinct from chat_documents_value then
            raise sqlstate 'PT409' using message = 'Chat documents changed';
        end if;
    end if;

    select coalesce(max(turn_number), 0) into last_turn
    from public.messages where chat_id = chat_id_value;

    if last_turn <> expected_turn then
        raise sqlstate 'PT409' using message = 'Chat has a newer turn';
    end if;

    insert into public.messages(chat_id, role, content, sources, turn_number)
    values (chat_id_value, 'user', question_text, '[]'::jsonb, last_turn + 1),
           (chat_id_value, 'assistant', answer_text, answer_sources, last_turn + 1);

    return chat_id_value;
end;
$$;

alter table public.ingestion_jobs add column error_code text;
grant select (error_code) on public.ingestion_jobs to authenticated;

alter table public.ingestion_jobs add column workflow_dispatch_until timestamptz;

create function public.reserve_ingestion_dispatch(target_job_id uuid)
returns timestamptz language sql set search_path = ''
as $$
    update public.ingestion_jobs
    set workflow_dispatch_until = now() + interval '10 minutes'
    where id = target_job_id and status in ('queued', 'processing')
      and (workflow_dispatch_until is null or workflow_dispatch_until <= now())
    returning workflow_dispatch_until;
$$;

create function public.release_ingestion_dispatch(target_job_id uuid, reservation timestamptz)
returns void language sql set search_path = ''
as $$
    update public.ingestion_jobs set workflow_dispatch_until = null
    where id = target_job_id and workflow_dispatch_until = reservation;
$$;

revoke all on function public.reserve_ingestion_dispatch(uuid),
    public.release_ingestion_dispatch(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ingestion_dispatch(uuid),
    public.release_ingestion_dispatch(uuid, timestamptz) to service_role;

create function public.retry_ingestion(target_document_id uuid, target_owner_id uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare
    job public.ingestion_jobs%rowtype;
begin
    select ingestion.* into job
    from public.ingestion_jobs as ingestion
    join public.documents as document on document.id = ingestion.document_id
    where document.id = target_document_id and document.owner_id = target_owner_id
    for update of ingestion;
    if not found then
        raise sqlstate 'PT404' using message = 'Job not found';
    end if;

    if job.status = 'failed' then
        delete from public.chunks where document_id = job.document_id;
        update public.ingestion_jobs
        set status = 'queued', completed_steps = 0, plan_hash = null, failure_count = 0,
            error_code = null, workflow_dispatch_until = null, lease_token = null, lease_expires_at = null,
            available_at = now(), updated_at = now()
        where id = job.id returning * into job;
        update public.documents set status = 'processing' where id = job.document_id;
    end if;
    return pg_catalog.to_jsonb(job);
end;
$$;

revoke all on function public.charge_usage(text, integer, integer, text, integer),
    public.save_chat_turn(uuid, uuid, uuid[], integer, text, text, jsonb),
    public.retry_ingestion(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.charge_usage(text, integer, integer, text, integer),
    public.save_chat_turn(uuid, uuid, uuid[], integer, text, text, jsonb),
    public.retry_ingestion(uuid, uuid) to service_role;

drop function public.claim_ingestion(integer);
drop function public.fail_ingestion(uuid, uuid, boolean, integer, integer);

create function public.claim_ingestion(lease_seconds integer, target_job_id uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    job public.ingestion_jobs%rowtype;
    document public.documents%rowtype;
begin
    select * into job
    from public.ingestion_jobs
    where (target_job_id is null or id = target_job_id)
      and ((status = 'queued' and available_at <= now())
       or (status = 'processing' and lease_expires_at <= now()))
    order by updated_at, id
    limit 1
    for update skip locked;

    if not found then
        return null;
    end if;

    update public.ingestion_jobs
    set status = 'processing', updated_at = now(),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + pg_catalog.make_interval(secs => lease_seconds)
    where id = job.id
    returning * into job;

    update public.documents
    set status = 'processing'
    where id = job.document_id
    returning * into document;

    return pg_catalog.jsonb_build_object(
        'job_id', job.id, 'document_id', document.id, 'lease_token', job.lease_token,
        'completed_steps', job.completed_steps, 'plan_hash', job.plan_hash,
        'bucket', document.storage_bucket, 'path', document.storage_path,
        'filename', document.filename
    );
end;
$$;

create function public.fail_ingestion(
    target_job_id uuid, target_lease uuid, retryable boolean,
    failure_limit integer, delay_seconds integer, failure_code text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
    job public.ingestion_jobs%rowtype;
    next_status text;
begin
    select * into job from public.ingestion_jobs
    where id = target_job_id and status = 'processing'
      and lease_token = target_lease and lease_expires_at > now()
    for update;

    if not found then
        return 'lease_lost';
    end if;

    next_status := case when retryable and job.failure_count + 1 < failure_limit
                        then 'queued' else 'failed' end;
    update public.ingestion_jobs
    set status = next_status, error_code = case when next_status = 'failed' then failure_code end,
        failure_count = failure_count + 1,
        lease_token = null, lease_expires_at = null,
        available_at = now() + pg_catalog.make_interval(secs => delay_seconds),
        updated_at = now()
    where id = job.id;

    if next_status = 'failed' then
        update public.documents set status = 'failed' where id = job.document_id;
    end if;
    return next_status;
end;
$$;

revoke all on function public.claim_ingestion(integer, uuid),
    public.fail_ingestion(uuid, uuid, boolean, integer, integer, text)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_ingestion(integer, uuid),
    public.fail_ingestion(uuid, uuid, boolean, integer, integer, text) to service_role;

commit;
