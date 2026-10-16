-- Supabase/PostgreSQL design; not connected to the browser-local demo.
-- Run only in a dedicated project after reviewing the provisioning policy.
create schema if not exists private;
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  primary key (organization_id,user_id)
);
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null, website text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  version integer not null check (version > 0), schema_version integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(), unique(company_id, version)
);
create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  status text not null check(status in ('queued','running','completed','partial','failed')),
  started_at timestamptz, finished_at timestamptz, warnings jsonb not null default '[]'
);
create table public.source_pages (
  id uuid primary key default gen_random_uuid(), crawl_run_id uuid not null references public.crawl_runs on delete cascade,
  url text not null, fetched_at timestamptz not null default now(), http_status integer,
  content_hash text, excerpt text
);
create index companies_organization on public.companies(organization_id);
create index members_user on public.organization_members(user_id);
create index crawl_runs_company on public.crawl_runs(company_id);
create index source_pages_run on public.source_pages(crawl_run_id);

-- Security-definer membership checks prevent recursive RLS on the membership table.
-- Deploy with a trusted owner, fixed search_path, and no caller-supplied user ID.
create function private.has_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any(roles));
$$;
create function private.company_access(company uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.companies c
    where c.id = company and private.has_role(c.organization_id, roles));
$$;
create function private.run_access(run uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.crawl_runs r
    where r.id = run and private.company_access(r.company_id, array['owner','admin','editor','viewer']));
$$;
revoke all on function private.has_role(uuid,text[]) from public;
revoke all on function private.company_access(uuid,text[]) from public;
revoke all on function private.run_access(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_role(uuid,text[]), private.company_access(uuid,text[]), private.run_access(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.companies enable row level security;
alter table public.knowledge_versions enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.source_pages enable row level security;

create policy organizations_read on public.organizations for select to authenticated
using(private.has_role(id,array['owner','admin','editor','viewer']));
create policy memberships_read on public.organization_members for select to authenticated
using(private.has_role(organization_id,array['owner','admin','editor','viewer']));
create policy companies_read on public.companies for select to authenticated
using(private.has_role(organization_id,array['owner','admin','editor','viewer']));
create policy companies_insert on public.companies for insert to authenticated
with check(private.has_role(organization_id,array['owner','admin','editor']));
create policy companies_update on public.companies for update to authenticated
using(private.has_role(organization_id,array['owner','admin','editor']))
with check(private.has_role(organization_id,array['owner','admin','editor']));
create policy companies_delete on public.companies for delete to authenticated
using(private.has_role(organization_id,array['owner','admin']));
create policy versions_read on public.knowledge_versions for select to authenticated
using(private.company_access(company_id,array['owner','admin','editor','viewer']));
create policy versions_insert on public.knowledge_versions for insert to authenticated
with check(created_by = (select auth.uid()) and private.company_access(company_id,array['owner','admin','editor']));
create policy runs_read on public.crawl_runs for select to authenticated
using(private.company_access(company_id,array['owner','admin','editor','viewer']));
create policy sources_read on public.source_pages for select to authenticated
using(private.run_access(crawl_run_id));

-- Revoke defaults before selectively granting application permissions.
revoke all on public.organizations, public.organization_members, public.companies,
  public.knowledge_versions, public.crawl_runs, public.source_pages from anon, authenticated;
grant select on public.organizations, public.organization_members, public.knowledge_versions,
  public.crawl_runs, public.source_pages to authenticated;
grant select,insert,update,delete on public.companies to authenticated;
grant insert on public.knowledge_versions to authenticated;
-- No client update/delete permissions for historical versions.
-- Organization provisioning, memberships, and crawl writes use a trusted backend.
-- The service-role key must never reach the browser.
