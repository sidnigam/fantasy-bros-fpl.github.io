-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Then Project Settings > API: copy the Project URL and the "anon public" key into
-- data/polls/polls.json ("supabase": {"url": ..., "anon_key": ...}). The anon key is
-- meant to be public; the policies below are what keep the data safe.

create table if not exists poll_meta (
  poll_id    text primary key,
  closes_at  timestamptz not null          -- kickoff: entries lock, picks are revealed
);

create table if not exists poll_responses (
  poll_id    text not null references poll_meta(poll_id),
  entry_id   text not null,                -- FPL entry id from roster.csv
  answers    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, entry_id)          -- one lock-in per manager; no edits
);

alter table poll_meta      enable row level security;
alter table poll_responses enable row level security;

-- everyone can read kickoff times
create policy "meta readable" on poll_meta for select to anon using (true);

-- anyone can lock in, only before kickoff (no update/delete policies => immutable)
create policy "insert before kickoff" on poll_responses for insert to anon
  with check (now() < (select closes_at from poll_meta m where m.poll_id = poll_responses.poll_id));

-- picks are only readable once the poll has closed
create policy "read after kickoff" on poll_responses for select to anon
  using (now() >= (select closes_at from poll_meta m where m.poll_id = poll_responses.poll_id));

-- before kickoff the site can still show WHO has locked in (never what they picked)
create or replace function poll_submitters(p text)
returns table (entry_id text) language sql security definer set search_path = public as
$$ select entry_id from poll_responses where poll_id = p $$;
grant execute on function poll_submitters(text) to anon;

-- the first poll. closes_at = 11:30am US Eastern (EST, UTC-5) on 1 Nov 2026.
insert into poll_meta (poll_id, closes_at)
values ('big-1-liv-ars', '2026-11-01T16:30:00Z')
on conflict (poll_id) do update set closes_at = excluded.closes_at;

-- ---------------------------------------------------------------------------
-- Mods view: lets the unlisted mods page read entries BEFORE kickoff, but only
-- with a secret key. The key lives only in this table (never commit it): run
--     insert into poll_admin (secret) values ('<your-secret>');
-- separately. RLS is on with no policies, so anon can't read the table directly.
create table if not exists poll_admin (secret text primary key);
alter table poll_admin enable row level security;

create or replace function poll_admin_responses(p text, k text)
returns table (entry_id text, answers jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from poll_admin where secret = k) then
    raise exception 'forbidden';
  end if;
  return query select r.entry_id, r.answers, r.created_at
               from poll_responses r where r.poll_id = p order by r.created_at;
end $$;
grant execute on function poll_admin_responses(text, text) to anon;
