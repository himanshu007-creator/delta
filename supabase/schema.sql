-- LEDE — free-tier metering and launch list.
--
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Why SQL functions rather than read-then-write from the app: two concurrent
-- serverless invocations would both read 10 and both write 11, and the free
-- tier would leak. `on conflict ... set x = table.x + n` is atomic; a
-- read-modify-write from Node is not.

-- ---------------------------------------------------------------------------
-- The usage meter AND the launch mailing list. One table, because the whole
-- point of asking for an email was to be able to reach these people later.
-- ---------------------------------------------------------------------------
create table if not exists free_usage (
  email       text primary key,
  rows_used   integer     not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  -- Set true once they buy, so the list can be segmented on launch day.
  converted   boolean     not null default false
);

create index if not exists free_usage_first_seen_idx on free_usage (first_seen desc);

-- ---------------------------------------------------------------------------
-- Global daily ceiling. Protects the shared Groq key from a scripted abuser.
-- ---------------------------------------------------------------------------
create table if not exists daily_usage (
  day        date primary key,
  rows_used  integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Accessors. SECURITY DEFINER so the service role is the only caller that
-- needs table privileges; RLS below denies everything else outright.
-- ---------------------------------------------------------------------------

create or replace function free_rows_for_user(p_email text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select rows_used from free_usage where email = lower(trim(p_email))), 0);
$$;

create or replace function bump_free_rows_for_user(p_email text, p_n integer)
returns integer language sql volatile security definer set search_path = public as $$
  insert into free_usage (email, rows_used)
  values (lower(trim(p_email)), p_n)
  on conflict (email) do update
    set rows_used = free_usage.rows_used + excluded.rows_used,
        last_seen = now()
  returning rows_used;
$$;

create or replace function free_rows_today(p_day date)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select rows_used from daily_usage where day = p_day), 0);
$$;

create or replace function bump_free_rows_today(p_day date, p_n integer)
returns integer language sql volatile security definer set search_path = public as $$
  insert into daily_usage (day, rows_used)
  values (p_day, p_n)
  on conflict (day) do update
    set rows_used = daily_usage.rows_used + excluded.rows_used
  returning rows_used;
$$;

-- ---------------------------------------------------------------------------
-- Lock the tables down. These hold every address that ever tried the product,
-- so the anon key must not be able to read them. Only the service role (used
-- server-side only) gets through, and it bypasses RLS by design.
-- ---------------------------------------------------------------------------
alter table free_usage  enable row level security;
alter table daily_usage enable row level security;

revoke all on free_usage  from anon, authenticated;
revoke all on daily_usage from anon, authenticated;

-- The functions are the only sanctioned path in, and even those are not
-- granted to anon: the app calls them with the service role.
revoke all on function bump_free_rows_for_user(text, integer) from anon, authenticated;
revoke all on function bump_free_rows_today(date, integer)    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Licences. Written by the Creem webhook, read by /api/research.
--
-- We store Creem's keys and check them against THIS table rather than calling
-- Creem's /licenses/validate on every request. Creem's validate needs an
-- instance_id from a prior activate call, so honouring it would mean an
-- activation dance plus a network round-trip in the hot path of every run.
-- We need per-licence row counting anyway, which Creem's activation model
-- does not give us, so the local table is both faster and more useful.
-- ponytail: no activation/instance tracking. Add it if key sharing shows up
-- in rows_used, which is the number that would reveal it.
-- ---------------------------------------------------------------------------
create table if not exists licenses (
  key        text primary key,
  email      text not null,
  order_id   text,
  product_id text,
  -- Cents, as Creem reports it. Kept so profit can be reconciled against
  -- the hackathon's "revenue - refunds - fees" definition.
  amount     integer,
  rows_used  integer     not null default 0,
  revoked    boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists licenses_email_idx on licenses (email);

-- Insert from the webhook. Idempotent: Creem retries up to 5 times and a
-- manual resend arrives with a fresh event id, so this must not double-write.
create or replace function record_license(
  p_key text, p_email text, p_order_id text, p_product_id text, p_amount integer
) returns void language sql volatile security definer set search_path = public as $$
  insert into licenses (key, email, order_id, product_id, amount)
  values (p_key, lower(trim(p_email)), p_order_id, p_product_id, p_amount)
  on conflict (key) do nothing;

  -- Mark them converted in the launch list, so it can be segmented.
  update free_usage set converted = true where email = lower(trim(p_email));
$$;

-- Check a licence and meter it in one atomic statement. Returns rows_used
-- after the increment, or null when the key is unknown or revoked. A separate
-- read-then-write would let two concurrent runs both pass a cap.
create or replace function use_license(p_key text, p_n integer)
returns integer language sql volatile security definer set search_path = public as $$
  update licenses set rows_used = rows_used + p_n
  where key = upper(trim(p_key)) and not revoked
  returning rows_used;
$$;

alter table licenses enable row level security;
revoke all on licenses from anon, authenticated;
revoke all on function record_license(text, text, text, text, integer) from anon, authenticated;
revoke all on function use_license(text, integer) from anon, authenticated;

-- ===========================================================================
-- DELTA: the crawl store.
--
-- Run this in the Supabase SQL editor after the sections above.
--
-- One database, deliberately. At 1,000 tracked companies the current state is
-- ~14MB and the append-only change log grows ~270MB/year, so the 500MB free
-- tier holds everything for well over a year. ClickHouse and object storage are
-- additive later: `changes` is append-only and self-contained, so moving it is
-- a copy rather than a migration, and nothing above it changes.
--
-- Same conventions as the licence tables: RLS on, privileges revoked from
-- anon/authenticated, every write through a SECURITY DEFINER function. The app
-- talks PostgREST with the service role and never the anon key.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- companies: GLOBAL and deduped. This is the economic core of the product.
--
-- One row per domain no matter how many customers watch it, so the marginal
-- cost of a customer who tracks Notion, Slack or HubSpot is zero. The scheduler
-- reads from here and NEVER from watchlists, which is what makes that true.
-- ---------------------------------------------------------------------------
create table if not exists companies (
  domain          text primary key,
  name            text,
  category        text,
  -- active | paused (nothing readable) | dead (domain gone)
  status          text        not null default 'active',
  -- Discovered identifiers: github, ats, npm, appStoreId, statusHost…
  -- jsonb because the set grows with every adapter and a column per handle
  -- would mean a migration each time.
  handles         jsonb       not null default '{}'::jsonb,
  first_seen      timestamptz not null default now(),
  last_window_at  timestamptz,
  fail_count      integer     not null default 0,
  -- Which licence asked for it first — the coverage flywheel, and the audit
  -- trail for why we are crawling a domain at all.
  requested_by    text
);

create index if not exists companies_status_idx on companies (status, last_window_at nulls first);

-- ---------------------------------------------------------------------------
-- watchlists: the ONLY per-customer table. Many-to-many on purpose.
-- ---------------------------------------------------------------------------
create table if not exists watchlists (
  license_key    text        not null,
  company_domain text        not null references companies (domain) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (license_key, company_domain)
);

create index if not exists watchlists_company_idx on watchlists (company_domain);

-- ---------------------------------------------------------------------------
-- surfaces: one row per (company, adapter). The crawl queue.
-- ---------------------------------------------------------------------------
create table if not exists surfaces (
  company_domain text    not null references companies (domain) on delete cascade,
  kind           text    not null,
  cadence        text    not null default '12h',
  -- The content hash from the last successful read. Matching it on the next
  -- window short-circuits parsing AND any LLM spend, which is what makes ~40
  -- sources per company affordable.
  last_hash      text,
  last_ok_at     timestamptz,
  last_try_at    timestamptz,
  status         text,
  fail_count     integer not null default 0,
  primary key (company_domain, kind)
);

-- Drives claim_surfaces: oldest success first, skipping surfaces that keep failing.
create index if not exists surfaces_due_idx on surfaces (last_try_at nulls first, last_ok_at nulls first)
  where fail_count < 5;

-- ---------------------------------------------------------------------------
-- facts: CURRENT state, upserted. One row per (company, path).
-- ---------------------------------------------------------------------------
create table if not exists facts (
  company_domain text        not null references companies (domain) on delete cascade,
  path           text        not null,
  value          text,
  -- Below 1 means "parsed, not published". Stored so the UI can say so.
  confidence     real,
  source_url     text,
  -- The verbatim text the value came from. A fact we cannot quote is a fact we
  -- will not publish, so this travels with the value rather than beside it.
  quote          text,
  kind           text        not null,
  updated_at     timestamptz not null default now(),
  primary key (company_domain, path)
);

create index if not exists facts_path_idx on facts (path, value);

-- ---------------------------------------------------------------------------
-- changes: APPEND-ONLY. This is the product.
--
-- Current state is commoditised — anyone can read a pricing page today. This
-- table is the part nobody else has, and it only ever grows.
-- ---------------------------------------------------------------------------
create table if not exists changes (
  id             bigserial   primary key,
  at             timestamptz not null default now(),
  company_domain text        not null,
  kind           text        not null,
  path           text        not null,
  old_value      text,
  new_value      text,
  source_url     text,
  quote          text
);

create index if not exists changes_company_at_idx on changes (company_domain, at desc);
create index if not exists changes_at_idx on changes (at desc);
create index if not exists changes_path_idx on changes (path, at desc);

-- ---------------------------------------------------------------------------
-- Writers. All SECURITY DEFINER; the service role is the only caller.
-- ---------------------------------------------------------------------------

create or replace function upsert_company(
  p_domain text, p_name text, p_category text, p_handles jsonb, p_requested_by text
) returns void language sql volatile security definer set search_path = public as $$
  insert into companies (domain, name, category, handles, requested_by)
  values (lower(trim(p_domain)), p_name, p_category, coalesce(p_handles, '{}'::jsonb), p_requested_by)
  on conflict (domain) do update
    -- Merge handles rather than replace: discovery finds them one at a time,
    -- and a later adapter must not wipe what an earlier one learned.
    set handles  = companies.handles || coalesce(excluded.handles, '{}'::jsonb),
        name     = coalesce(excluded.name, companies.name),
        category = coalesce(excluded.category, companies.category);
$$;

/** Register the surfaces an adapter set applies to. Idempotent. */
create or replace function register_surfaces(p_domain text, p_kinds text[], p_cadences text[])
returns integer language sql volatile security definer set search_path = public as $$
  with ins as (
    insert into surfaces (company_domain, kind, cadence)
    select lower(trim(p_domain)), k.kind, coalesce(c.cadence, '12h')
      from unnest(p_kinds) with ordinality as k(kind, i)
      left join unnest(p_cadences) with ordinality as c(cadence, i) using (i)
    on conflict (company_domain, kind) do nothing
    returning 1
  )
  select coalesce(count(*)::integer, 0) from ins;
$$;

/**
 * Atomically claim up to p_limit surfaces that are due this window.
 *
 * FOR UPDATE SKIP LOCKED is the whole point: the crawl endpoint self-chains and
 * may overlap with itself or a manual run, and without this two invocations
 * would claim the same surfaces and double-fetch every source.
 */
create or replace function claim_surfaces(p_window_at timestamptz, p_limit integer)
returns table (company_domain text, kind text, last_hash text, handles jsonb, name text)
language sql volatile security definer set search_path = public as $$
  with due as (
    select s.company_domain, s.kind
      from surfaces s
      join companies c on c.domain = s.company_domain
     where c.status = 'active'
       and s.fail_count < 5
       and (s.last_try_at is null or s.last_try_at < p_window_at)
     order by s.last_ok_at nulls first, s.company_domain
     limit p_limit
     for update of s skip locked
  ), claimed as (
    update surfaces s set last_try_at = p_window_at
      from due
     where s.company_domain = due.company_domain and s.kind = due.kind
    returning s.company_domain, s.kind, s.last_hash
  )
  select cl.company_domain, cl.kind, cl.last_hash, co.handles, co.name
    from claimed cl join companies co on co.domain = cl.company_domain;
$$;

/**
 * Record one surface read: upsert the facts, and append a change row for each
 * value that actually MOVED. Returns how many changes were appended.
 *
 * Diffing in SQL rather than in the app is deliberate — a read-then-write from
 * a serverless function would race two concurrent windows and either duplicate
 * or lose change rows. Here the compare and the insert are one statement.
 *
 * A fact's FIRST observation is not a change. Recording one would make every
 * newly tracked company look like it changed everything on day one.
 */
create or replace function record_surface(
  p_domain text, p_kind text, p_hash text, p_facts jsonb
) returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_changes  integer := 0;
  v_fact     jsonb;
  v_path     text;
  v_new      text;
  v_new_conf real;
  v_old      text;
  v_old_kind text;
  v_old_conf real;
  v_seen     boolean;
  v_touched  text[] := '{}';
begin
  for v_fact in select value from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) loop
    v_path := v_fact->>'path';
    continue when v_path is null or v_path = '';
    v_new      := v_fact->>'value';
    v_new_conf := nullif(v_fact->>'confidence', '')::real;

    v_seen := false;
    select f.value, f.kind, f.confidence, true
      into v_old, v_old_kind, v_old_conf, v_seen
      from facts f
     where f.company_domain = p_domain and f.path = v_path;

    /*
     * SOURCE PRECEDENCE.
     *
     * Several adapters legitimately report the same path. corporate.gleif gives
     * a registry legal name in capitals ("ADYEN N.V.") while identity.schema
     * gives the branded form ("Adyen N.V."). Without a rule, whichever ran last
     * won — so the value flip-flopped and manufactured a FAKE CHANGE every
     * window, forever, in the one table we actually sell.
     *
     * So a fact belongs to the source that reported it with the highest
     * confidence, and a different source with lower or equal confidence may not
     * take it. Ties keep the incumbent, which is what makes it stable.
     */
    if v_seen and v_old_kind is distinct from p_kind
       and coalesce(v_old_conf, 0) >= coalesce(v_new_conf, 0) then
      continue;
    end if;

    /*
     * WITHIN-BATCH DUPLICATES.
     *
     * One extract() may emit the same path twice — the pricing parser emitted
     * two different `pricing.note` diagnostics in a single call. The second
     * then saw the first as an existing same-kind value and recorded a change,
     * so four companies showed a "change" on their very first crawl. A repeat
     * inside one batch is not a value moving over time; last write wins and no
     * change is recorded.
     */
    if v_path = any(v_touched) then
      update facts set value = v_new, confidence = v_new_conf,
             source_url = v_fact->>'source_url', quote = v_fact->>'quote',
             kind = p_kind, updated_at = now()
       where company_domain = p_domain and path = v_path;
      continue;
    end if;
    v_touched := v_touched || v_path;

    if v_old is distinct from v_new then
      /*
       * A change is a value moving OVER TIME, from the same source. A different
       * source disagreeing is not a change, it is a disagreement — and a fact's
       * first observation is not a change either, or every newly tracked
       * company would look like it changed everything on day one.
       */
      if v_seen and v_old_kind = p_kind then
        insert into changes (company_domain, kind, path, old_value, new_value, source_url, quote)
        values (p_domain, p_kind, v_path, v_old, v_new, v_fact->>'source_url', v_fact->>'quote');
        v_changes := v_changes + 1;
      end if;

      insert into facts (company_domain, path, value, confidence, source_url, quote, kind, updated_at)
      values (p_domain, v_path, v_new, v_new_conf, v_fact->>'source_url', v_fact->>'quote', p_kind, now())
      on conflict (company_domain, path) do update
        set value      = excluded.value,
            confidence = excluded.confidence,
            source_url = excluded.source_url,
            quote      = excluded.quote,
            kind       = excluded.kind,
            updated_at = now();
    end if;
  end loop;

  update surfaces
     set last_hash = coalesce(p_hash, last_hash),
         last_ok_at = now(), status = 'ok', fail_count = 0
   where company_domain = p_domain and kind = p_kind;

  update companies set last_window_at = now(), fail_count = 0 where domain = p_domain;
  return v_changes;
end;
$$;

/** Unchanged content: touch the clock, parse nothing, spend no tokens. */
create or replace function record_unchanged(p_domain text, p_kind text)
returns void language sql volatile security definer set search_path = public as $$
  update surfaces set last_ok_at = now(), status = 'unchanged', fail_count = 0
   where company_domain = p_domain and kind = p_kind;
$$;

/** A failure backs the surface off; five strikes and the index stops offering it. */
create or replace function record_failure(p_domain text, p_kind text, p_reason text)
returns void language sql volatile security definer set search_path = public as $$
  update surfaces
     set status = left(coalesce(p_reason, 'fail'), 60), fail_count = fail_count + 1
   where company_domain = p_domain and kind = p_kind;
$$;

create or replace function watch_company(p_license_key text, p_domain text)
returns void language sql volatile security definer set search_path = public as $$
  insert into watchlists (license_key, company_domain)
  values (p_license_key, lower(trim(p_domain)))
  on conflict (license_key, company_domain) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Readers. Named, parameterised; the app never sends SQL.
-- ---------------------------------------------------------------------------

create or replace function company_facts(p_domain text)
returns table (path text, value text, confidence real, source_url text, quote text, kind text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.path, f.value, f.confidence, f.source_url, f.quote, f.kind, f.updated_at
    from facts f where f.company_domain = lower(trim(p_domain))
   order by f.path;
$$;

create or replace function company_changes(p_domain text, p_limit integer default 200)
returns table (at timestamptz, kind text, path text, old_value text, new_value text, source_url text, quote text)
language sql stable security definer set search_path = public as $$
  select c.at, c.kind, c.path, c.old_value, c.new_value, c.source_url, c.quote
    from changes c where c.company_domain = lower(trim(p_domain))
   order by c.at desc limit least(coalesce(p_limit, 200), 1000);
$$;

/** Changes across a customer's whole watchlist — the digest and the feed. */
create or replace function watchlist_changes(p_license_key text, p_since timestamptz, p_limit integer default 200)
returns table (at timestamptz, company_domain text, kind text, path text, old_value text, new_value text, source_url text, quote text)
language sql stable security definer set search_path = public as $$
  select c.at, c.company_domain, c.kind, c.path, c.old_value, c.new_value, c.source_url, c.quote
    from changes c
    join watchlists w on w.company_domain = c.company_domain
   where w.license_key = p_license_key
     and c.at >= coalesce(p_since, now() - interval '7 days')
   order by c.at desc limit least(coalesce(p_limit, 200), 1000);
$$;

/** Everyone using a vendor — the /stack/[vendor] pages, from live data. */
create or replace function vendor_adopters(p_vendor text)
returns table (company_domain text, source_url text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.company_domain, f.source_url, f.updated_at
    from facts f
   where f.path = 'stack.vendor.' || lower(trim(p_vendor)) and f.value = 'true'
   order by f.company_domain;
$$;

create or replace function crawl_stats()
returns table (companies bigint, surfaces bigint, facts bigint, changes bigint, due bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from companies where status = 'active'),
         (select count(*) from surfaces),
         (select count(*) from facts),
         (select count(*) from changes),
         (select count(*) from surfaces where fail_count < 5
            and (last_try_at is null or last_try_at < date_trunc('hour', now()) - interval '11 hours'));
$$;

-- ---------------------------------------------------------------------------
-- Lock it all down. These tables hold the whole dataset; the anon key must not
-- reach them, and the functions are the only sanctioned path in.
-- ---------------------------------------------------------------------------
alter table companies  enable row level security;
alter table watchlists enable row level security;
alter table surfaces   enable row level security;
alter table facts      enable row level security;
alter table changes    enable row level security;

revoke all on companies  from anon, authenticated;
revoke all on watchlists from anon, authenticated;
revoke all on surfaces   from anon, authenticated;
revoke all on facts      from anon, authenticated;
revoke all on changes    from anon, authenticated;

revoke all on function upsert_company(text, text, text, jsonb, text)   from anon, authenticated;
revoke all on function register_surfaces(text, text[], text[])         from anon, authenticated;
revoke all on function claim_surfaces(timestamptz, integer)            from anon, authenticated;
revoke all on function record_surface(text, text, text, jsonb)         from anon, authenticated;
revoke all on function record_unchanged(text, text)                    from anon, authenticated;
revoke all on function record_failure(text, text, text)                from anon, authenticated;
revoke all on function watch_company(text, text)                       from anon, authenticated;
revoke all on function company_facts(text)                             from anon, authenticated;
revoke all on function company_changes(text, integer)                  from anon, authenticated;
revoke all on function watchlist_changes(text, timestamptz, integer)   from anon, authenticated;
revoke all on function vendor_adopters(text)                           from anon, authenticated;
revoke all on function crawl_stats()                                   from anon, authenticated;
