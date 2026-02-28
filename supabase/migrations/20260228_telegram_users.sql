-- =====================================
-- Phase 6: Telegram users linking table
-- =====================================

CREATE TABLE public.telegram_users (
  telegram_id BIGINT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  default_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

-- Only accessible via service role (bot edge function)
CREATE POLICY "Service role only" ON public.telegram_users FOR ALL USING (false);

-- Index for looking up by user_id (e.g. checking if user already linked)
CREATE INDEX idx_telegram_users_user_id ON public.telegram_users (user_id);
