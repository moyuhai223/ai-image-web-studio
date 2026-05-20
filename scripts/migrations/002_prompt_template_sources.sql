alter table prompt_templates add column if not exists source_key text;
alter table prompt_templates add column if not exists source_name text;
alter table prompt_templates add column if not exists source_url text;
alter table prompt_templates add column if not exists source_license text;

create unique index if not exists prompt_templates_source_key_unique_idx
  on prompt_templates(source_key)
  where source_key is not null;

