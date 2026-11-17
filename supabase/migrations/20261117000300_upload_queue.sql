begin;

create function public.queue_document_ingestion(
    target_document_id uuid,
    target_owner_id uuid,
    max_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    reserved public.documents%rowtype;
    job public.ingestion_jobs%rowtype;
    stored_size text;
begin
    if max_bytes is null or max_bytes <= 0 then
        raise exception 'The upload limit must be positive';
    end if;

    select * into reserved
    from public.documents
    where id = target_document_id and owner_id = target_owner_id
    for update;

    if not found then
        raise sqlstate 'PT404' using message = 'Document not found';
    end if;

    select * into job
    from public.ingestion_jobs
    where document_id = reserved.id;

    if found then
        return pg_catalog.to_jsonb(job);
    end if;

    select object.metadata ->> 'size' into stored_size
    from storage.objects as object
    join storage.buckets as bucket on bucket.id = object.bucket_id
    where object.bucket_id = reserved.storage_bucket
      and object.name = reserved.storage_path
      and bucket.public is false;

    if not found or reserved.status <> 'pending' then
        raise sqlstate 'PT409' using message = 'Upload has not finished';
    end if;
    if stored_size is null or stored_size !~ '^[0-9]{1,18}$' then
        raise sqlstate 'PT422' using message = 'Upload size could not be verified';
    end if;
    if stored_size::bigint = 0 then
        raise sqlstate 'PT422' using message = 'Upload is empty';
    end if;
    if stored_size::bigint > max_bytes then
        raise sqlstate 'PT413' using message = 'Upload is too large';
    end if;

    insert into public.ingestion_jobs (document_id)
    values (reserved.id)
    returning * into job;

    return pg_catalog.to_jsonb(job);
end;
$$;

revoke all on function public.queue_document_ingestion(uuid, uuid, bigint)
    from public, anon, authenticated, service_role;
grant execute on function public.queue_document_ingestion(uuid, uuid, bigint)
    to service_role;

commit;
