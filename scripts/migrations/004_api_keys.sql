-- v0.8.10: 每用户自助 API Key(对外 OpenAI 兼容接口 /v1/* 的 bearer 鉴权)。
-- 只存 sha256 哈希(入站凭据无需还原明文);key_prefix 是明文前缀,仅用于列表识别。
-- revoked_at 非空即吊销(不物理删,留审计线索);unique(key_hash) 兼作查找索引。

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default '',
  key_hash text not null unique,
  key_prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_keys_user_created_idx on api_keys(user_id, created_at desc);
