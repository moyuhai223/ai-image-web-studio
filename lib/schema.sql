create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'member')) default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  ip text not null,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  username text not null default '',
  action text not null,
  target_type text not null default '',
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  model text not null,
  prompt text not null,
  size text not null default '1024x1024',
  count integer not null default 1 check (count between 1 and 4),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')) default 'queued',
  provider text not null default 'provider',
  provider_request_id text,
  error_message text,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table generation_jobs add column if not exists started_at timestamptz;
alter table generation_jobs add column if not exists completed_at timestamptz;
alter table generation_jobs add column if not exists duration_ms integer;
alter table generation_jobs alter column provider set default 'provider';

create table if not exists reference_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  local_path text not null,
  mime_type text not null,
  byte_size integer not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table if not exists generated_images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references generation_jobs(id) on delete cascade,
  parent_image_id uuid references generated_images(id) on delete set null,
  local_path text not null,
  mime_type text not null,
  width integer,
  height integer,
  byte_size integer not null,
  checksum text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table generated_images add column if not exists parent_image_id uuid;

create table if not exists generated_image_tags (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references generated_images(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 32),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists generated_image_favorites (
  user_id uuid not null references users(id) on delete cascade,
  image_id uuid not null references generated_images(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, image_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generated_images_parent_image_fk'
  ) then
    alter table generated_images
      add constraint generated_images_parent_image_fk
      foreign key (parent_image_id)
      references generated_images(id)
      on delete set null;
  end if;
end $$;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists prompt_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '通用',
  content text not null,
  source_key text,
  source_name text,
  source_url text,
  source_license text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table prompt_templates add column if not exists source_key text;
alter table prompt_templates add column if not exists source_name text;
alter table prompt_templates add column if not exists source_url text;
alter table prompt_templates add column if not exists source_license text;

create index if not exists generation_jobs_user_created_idx on generation_jobs(user_id, created_at desc);
create index if not exists generation_jobs_status_idx on generation_jobs(status);
create index if not exists generation_jobs_status_created_idx on generation_jobs(status, created_at asc);
create index if not exists generated_images_job_idx on generated_images(job_id, sort_order);
create index if not exists generated_images_parent_idx on generated_images(parent_image_id);
create unique index if not exists generated_image_tags_image_tag_idx on generated_image_tags (image_id, lower(tag));
create index if not exists generated_image_tags_tag_idx on generated_image_tags (lower(tag), created_at desc);
create index if not exists generated_image_tags_image_idx on generated_image_tags (image_id);
create index if not exists generated_image_favorites_image_idx on generated_image_favorites (image_id);
create index if not exists generated_image_favorites_user_created_idx on generated_image_favorites (user_id, created_at desc);
create index if not exists login_attempts_username_created_idx on login_attempts(lower(username), created_at desc);
create index if not exists login_attempts_ip_created_idx on login_attempts(ip, created_at desc);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);
create index if not exists audit_logs_user_created_idx on audit_logs(user_id, created_at desc);
create index if not exists audit_logs_action_created_idx on audit_logs(action, created_at desc);
create index if not exists prompt_templates_category_created_idx on prompt_templates(category, created_at desc);
create unique index if not exists prompt_templates_source_key_unique_idx on prompt_templates(source_key) where source_key is not null;
create index if not exists reference_images_created_idx on reference_images(created_at desc);
create index if not exists generation_jobs_ref_path_idx on generation_jobs ((request_metadata -> 'reference' ->> 'localPath'));
create index if not exists generation_jobs_ref_path_created_idx on generation_jobs ((request_metadata -> 'reference' ->> 'localPath'), created_at desc);
create index if not exists reference_images_checksum_idx on reference_images (checksum);
