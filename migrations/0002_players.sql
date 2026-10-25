create table if not exists players (
  user_id    text primary key,
  nick       text not null,
  avatar     text not null,
  test_mode  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ledger (
  id       text primary key,
  user_id  text not null,
  seq      bigserial,
  at       timestamptz not null default now(),
  kind     text not null,
  amount   integer not null,
  balance  integer not null,
  ref      text
);

create index if not exists ledger_user_seq_idx on ledger (user_id, seq desc);
