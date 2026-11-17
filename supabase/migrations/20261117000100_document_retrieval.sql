begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create table public.documents (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid references auth.users(id) on delete cascade,
    filename text not null,
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'ready', 'failed')),
    created_at timestamptz not null default now()
);

comment on column public.documents.owner_id is
    'Null identifies an administrator-provided sample document.';

create table public.chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.documents(id) on delete cascade,
    position integer not null check (position >= 0),
    location text not null,
    content text not null,
    embedding_model text not null,
    embedding extensions.vector not null,
    unique (document_id, position)
);

alter table public.documents enable row level security;
alter table public.chunks enable row level security;

revoke all on public.documents, public.chunks from public, anon, authenticated;
grant select on public.documents, public.chunks to anon, authenticated;
grant all on public.documents, public.chunks to service_role;

create policy documents_read on public.documents
    for select to anon, authenticated
    using (
        (owner_id is null and status = 'ready')
        or owner_id = (select auth.uid())
    );

create policy chunks_read on public.chunks
    for select to anon, authenticated
    using (
        exists (
            select 1 from public.documents document
            where document.id = chunks.document_id and document.status = 'ready'
        )
    );

create function public.search_chunks(
    query_embedding extensions.vector,
    query_model text,
    document_ids uuid[],
    match_count integer
)
returns table (
    chunk_id uuid, document_id uuid, filename text, location text, content text
)
language sql stable security invoker
set search_path = ''
as $$
    select chunk.id, chunk.document_id, document.filename, chunk.location, chunk.content
    from public.chunks chunk
    join public.documents document on document.id = chunk.document_id
    where document.status = 'ready'
      and chunk.document_id = any(document_ids)
      and chunk.embedding_model = query_model
      and extensions.vector_dims(chunk.embedding) = extensions.vector_dims(query_embedding)
    order by chunk.embedding operator(extensions.<=>) query_embedding, chunk.id
    limit least(greatest(match_count, 0), 40);
$$;

revoke all on function public.search_chunks(extensions.vector, text, uuid[], integer)
    from public, anon, authenticated, service_role;
grant execute on function public.search_chunks(extensions.vector, text, uuid[], integer)
    to anon, authenticated;

commit;
