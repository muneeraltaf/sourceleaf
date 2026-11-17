begin;

alter table public.ingestion_jobs
    add column available_at timestamptz not null default now(),
    add column lease_token uuid,
    add column lease_expires_at timestamptz,
    add column plan_hash text,
    add column failure_count integer not null default 0;

revoke select on public.ingestion_jobs from authenticated;
grant select (id, document_id, status, completed_steps, updated_at)
    on public.ingestion_jobs to authenticated;

create function public.claim_ingestion(lease_seconds integer)
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
    where (status = 'queued' and available_at <= now())
       or (status = 'processing' and lease_expires_at <= now())
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

create function public.save_ingestion_batch(
    target_job_id uuid, target_lease uuid, batch jsonb, total_chunks integer, content_hash text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
    job public.ingestion_jobs%rowtype;
    batch_size integer;
    last_position integer;
    next_status text;
begin
    select * into job from public.ingestion_jobs
    where id = target_job_id and status = 'processing'
      and lease_token = target_lease and lease_expires_at > now()
    for update;

    if not found then
        return 'lease_lost';
    end if;

    batch_size := pg_catalog.jsonb_array_length(batch);
    last_position := job.completed_steps + batch_size;
    if batch_size is null or batch_size = 0 or last_position > total_chunks
       or (job.plan_hash is not null and job.plan_hash <> content_hash) then
        raise exception 'Batch does not match the ingestion checkpoint';
    end if;

    insert into public.chunks (document_id, position, location, content, embedding_model, embedding)
    select job.document_id, job.completed_steps + (part.ordinality - 1)::integer,
           part.value ->> 'location', part.value ->> 'content',
           part.value ->> 'embedding_model', (part.value ->> 'embedding')::extensions.vector
    from pg_catalog.jsonb_array_elements(batch) with ordinality as part(value, ordinality);

    next_status := case when last_position = total_chunks then 'ready' else 'queued' end;
    update public.ingestion_jobs
    set status = next_status, completed_steps = last_position, plan_hash = content_hash,
        failure_count = 0, lease_token = null, lease_expires_at = null,
        available_at = now(), updated_at = now()
    where id = job.id;
    if next_status = 'ready' then
        update public.documents set status = 'ready' where id = job.document_id;
    end if;

    return next_status;
end;
$$;

create function public.fail_ingestion(
    target_job_id uuid, target_lease uuid, retryable boolean,
    failure_limit integer, delay_seconds integer
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
    set status = next_status, failure_count = failure_count + 1,
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

revoke all on function public.claim_ingestion(integer),
    public.save_ingestion_batch(uuid, uuid, jsonb, integer, text),
    public.fail_ingestion(uuid, uuid, boolean, integer, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.claim_ingestion(integer),
    public.save_ingestion_batch(uuid, uuid, jsonb, integer, text),
    public.fail_ingestion(uuid, uuid, boolean, integer, integer)
    to service_role;

commit;
