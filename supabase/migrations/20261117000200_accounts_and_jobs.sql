begin;

alter table public.documents
    add column storage_bucket text,
    add column storage_path text,
    add constraint documents_storage_pair
        check ((storage_bucket is null) = (storage_path is null)),
    add constraint documents_storage_owner
        check (storage_path is null or owner_id is not null),
    add unique (storage_bucket, storage_path);

create table public.ingestion_jobs (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null unique references public.documents(id) on delete cascade,
    status text not null default 'queued'
        check (status in ('queued', 'processing', 'ready', 'failed')),
    completed_steps integer not null default 0 check (completed_steps >= 0),
    updated_at timestamptz not null default now()
);

create table public.chats (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null,
    created_at timestamptz not null default now()
);

create table public.chat_documents (
    chat_id uuid not null references public.chats(id) on delete cascade,
    document_id uuid not null references public.documents(id) on delete cascade,
    primary key (chat_id, document_id)
);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    sources jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index chats_owner_idx on public.chats (owner_id);
create index messages_chat_idx on public.messages (chat_id, created_at);

alter table public.ingestion_jobs enable row level security;
alter table public.chats enable row level security;
alter table public.chat_documents enable row level security;
alter table public.messages enable row level security;

revoke all on public.ingestion_jobs, public.chats, public.chat_documents, public.messages
    from public, anon, authenticated;
grant select on public.ingestion_jobs, public.chats, public.chat_documents, public.messages
    to authenticated;
grant all on public.ingestion_jobs, public.chats, public.chat_documents, public.messages
    to service_role;

create policy jobs_read on public.ingestion_jobs
    for select to authenticated
    using (exists (
        select 1 from public.documents document
        where document.id = ingestion_jobs.document_id
          and document.owner_id = (select auth.uid())
    ));

create policy chats_read on public.chats
    for select to authenticated using (owner_id = (select auth.uid()));

create policy chat_documents_read on public.chat_documents
    for select to authenticated
    using (
        exists (select 1 from public.chats chat where chat.id = chat_documents.chat_id)
        and exists (
            select 1 from public.documents document where document.id = chat_documents.document_id
        )
    );

create policy messages_read on public.messages
    for select to authenticated
    using (exists (select 1 from public.chats chat where chat.id = messages.chat_id));

create policy document_objects_read on storage.objects
    for select to authenticated
    using (exists (
        select 1 from public.documents document
        where document.storage_bucket = objects.bucket_id
          and document.storage_path = objects.name
          and document.owner_id = (select auth.uid())
    ));

create policy document_objects_upload on storage.objects
    for insert to authenticated
    with check (exists (
        select 1 from public.documents document
        where document.storage_bucket = objects.bucket_id
          and document.storage_path = objects.name
          and document.owner_id = (select auth.uid())
          and document.status = 'pending'
    ));

commit;
