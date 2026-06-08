create table if not exists keihi_expenses (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  date date not null,
  amount integer not null,
  vendor text not null,
  category text not null,
  memo text,
  created_at timestamptz default now()
);

create index if not exists idx_keihi_expenses_user_date
  on keihi_expenses (line_user_id, date);

create table if not exists keihi_export_tokens (
  token uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  year int not null,
  month int not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists idx_keihi_export_tokens_expires
  on keihi_export_tokens (expires_at);
