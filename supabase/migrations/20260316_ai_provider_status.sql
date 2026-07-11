-- Operational status for server-side AI providers. Client roles cannot read or
-- write this table because it may expose billing and incident information.

CREATE TABLE IF NOT EXISTS public.ai_provider_status (
  provider text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('healthy', 'warning', 'critical', 'severe', 'error')),
  remaining_credits numeric,
  total_credits numeric,
  total_usage numeric,
  last_error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  alert_level text,
  alert_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_provider_status ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_provider_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_provider_status TO service_role;

COMMENT ON TABLE public.ai_provider_status IS
  'Server-only provider health, usage and credit balances used by the AI router and admin alerts.';
