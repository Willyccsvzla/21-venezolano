create table if not exists live_tables (
  id text primary key,
  name text not null,
  casa integer not null,
  entrada integer not null,
  seats_n integer not null,
  code text,
  private boolean not null default false,
  seats text not null,
  table_state text not null,
  hand text,
  queue text not null default '[]',
  version integer not null default 1,
  act_at bigint not null default 0
);

create unique index if not exists live_tables_code_idx on live_tables (code) where code is not null;

create table if not exists table_chat (
  id text primary key,
  table_id text not null,
  user_id text,
  name text not null,
  body text not null,
  at bigint not null
);

create index if not exists table_chat_lookup on table_chat (table_id, at);
