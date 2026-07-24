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

-- インボイス控除率マスタ（経過措置の日付範囲ごとの控除率）
create table if not exists invoice_deduction_rates (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  deduction_rate numeric(4, 3) not null,
  label text,
  created_at timestamptz default now(),
  constraint invoice_deduction_rates_date_range check (start_date <= end_date)
);

create index if not exists idx_invoice_deduction_rates_date_range
  on invoice_deduction_rates (start_date, end_date);

-- インボイス適格性の自動判定結果（judgeInvoice関数の出力）
create table if not exists invoice_judgments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references keihi_expenses (id) on delete cascade,
  line_user_id text not null,
  status text not null check (status in ('適格扱い', '要確認', '自動判定確定')),
  reason_code text check (
    reason_code in (
      'EXC_TRANSIT',
      'EXC_OCR_MISREAD',
      'EXC_NO_NUMBER_HIGH',
      'EXC_RATE_MISSING',
      'EXC_UNVERIFIED_NUMBER'
    )
  ),
  comment text,
  registration_number_raw text,
  registration_number text,
  rate_breakdown_amount integer,
  judged_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_invoice_judgments_expense_id
  on invoice_judgments (expense_id);

create index if not exists idx_invoice_judgments_user
  on invoice_judgments (line_user_id);

-- RLS: invoice_judgments は keihi_expenses と同じ考え方で本人のデータのみ操作可
alter table invoice_judgments enable row level security;

create policy "自分のデータのみ参照"
  on invoice_judgments for select
  using (line_user_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'line_user_id'::text));

create policy "自分のデータのみ挿入"
  on invoice_judgments for insert
  with check (line_user_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'line_user_id'::text));

create policy "自分のデータのみ更新"
  on invoice_judgments for update
  using (line_user_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'line_user_id'::text));

-- RLS: invoice_deduction_rates はマスタデータのため全員read可、書き込みポリシーは作らず
-- service_role_key（RLSをバイパスするサーバー専用キー）経由の管理者操作のみに限定する
alter table invoice_deduction_rates enable row level security;

create policy "全員参照可"
  on invoice_deduction_rates for select
  using (true);

-- invoice_deduction_rates 初期データ（経過措置の控除率スケジュール）
insert into invoice_deduction_rates (start_date, end_date, deduction_rate, label)
values
  ('2023-10-01', '2026-09-30', 0.800, '経過措置80%期間'),
  ('2026-10-01', '2028-09-30', 0.700, '経過措置70%期間'),
  ('2028-10-01', '2030-09-30', 0.500, '経過措置50%期間'),
  ('2030-10-01', '2031-09-30', 0.300, '経過措置30%期間'),
  ('2031-10-01', '9999-12-31', 0.000, '控除なし');

-- invoice_judgments: INSERT時にline_user_idがexpense_idの実際のline_user_idと一致することを検証
create or replace function invoice_judgments_check_line_user_id()
returns trigger as $$
begin
  if not exists (
    select 1 from keihi_expenses
    where id = new.expense_id
      and line_user_id = new.line_user_id
  ) then
    raise exception 'line_user_id (%) does not match keihi_expenses.line_user_id for expense_id %',
      new.line_user_id, new.expense_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_invoice_judgments_check_line_user_id
  before insert on invoice_judgments
  for each row
  execute function invoice_judgments_check_line_user_id();
