create table if not exists open_seats (
  user_id text primary key,
  staked integer not null,
  ceiling integer not null
);
