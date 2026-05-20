create table if not exists generated_image_favorites (
  user_id uuid not null references users(id) on delete cascade,
  image_id uuid not null references generated_images(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, image_id)
);

create index if not exists generated_image_favorites_image_idx
  on generated_image_favorites (image_id);

create index if not exists generated_image_favorites_user_created_idx
  on generated_image_favorites (user_id, created_at desc);
