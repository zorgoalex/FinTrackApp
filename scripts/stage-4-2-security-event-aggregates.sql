-- Stage 4.2 owner-controlled pilot aggregates.
-- Run only in the Supabase SQL Editor by the production owner.
-- The result deliberately excludes user/workspace identifiers, subject hashes,
-- metadata, email addresses, financial rows and free-form details.

-- Last 24 hours by bounded event type and outcome.
select
  event_type,
  outcome,
  count(*)::bigint as event_count
from private.security_events
where occurred_at >= now() - interval '24 hours'
group by event_type, outcome
order by event_type, outcome;

-- Seven calendar days by UTC day, bounded event type and outcome.
select
  (occurred_at at time zone 'UTC')::date as utc_day,
  event_type,
  outcome,
  count(*)::bigint as event_count
from private.security_events
where occurred_at >= now() - interval '7 days'
group by utc_day, event_type, outcome
order by utc_day desc, event_type, outcome;

-- Triage signal only. Investigate row-level evidence outside the pilot journal
-- and only after an actual incident justifies that access.
select
  outcome,
  count(*)::bigint as event_count
from private.security_events
where occurred_at >= now() - interval '7 days'
  and outcome in ('failure', 'blocked')
group by outcome
order by outcome;
