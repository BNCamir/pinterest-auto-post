create table if not exists topics (
  id bigserial primary key,
  primary_keyword text not null unique,
  supporting_keywords text[] not null,
  status text not null,
  selected_at timestamptz,
  used_at timestamptz
);

create table if not exists posts (
  id bigserial primary key,
  topic_id bigint not null references topics(id),
  shopify_post_id text not null,
  title text not null,
  canonical_url text not null,
  meta_title text not null,
  meta_description text not null,
  published_at timestamptz,
  status text not null
);

create table if not exists assets (
  id bigserial primary key,
  type text not null,
  provider text not null,
  storage_url text not null,
  checksum text,
  created_at timestamptz not null
);

create table if not exists pins (
  id bigserial primary key,
  post_id bigint not null references posts(id),
  pinterest_pin_id text not null,
  image_asset_id bigint not null references assets(id),
  title text not null,
  description text not null,
  destination_url text not null,
  platform_url text,
  status text not null,
  created_at timestamptz not null
);

create table if not exists runs (
  id bigserial primary key,
  scheduled_time timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  status text not null,
  error_summary text,
  retry_count integer default 0
);

create table if not exists logs (
  id bigserial primary key,
  run_id bigint references runs(id),
  step text not null,
  level text not null,
  message text not null,
  created_at timestamptz not null
);
