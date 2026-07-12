BEGIN;

CREATE TABLE public.notification_preferences (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channels text[] NOT NULL DEFAULT ARRAY['in_app', 'telegram']::text[] CHECK (cardinality(channels) BETWEEN 1 AND 12),
  event_types text[] NOT NULL DEFAULT ARRAY['cashflow_plan', 'scheduled_operation', 'debt_due']::text[] CHECK (cardinality(event_types) BETWEEN 1 AND 20),
  reminder_days smallint[] NOT NULL DEFAULT ARRAY[1, 0]::smallint[]
    CHECK (cardinality(reminder_days) BETWEEN 1 AND 8 AND 0 <= ALL(reminder_days) AND 30 >= ALL(reminder_days)),
  delivery_mode text NOT NULL DEFAULT 'individual' CHECK (delivery_mode IN ('individual', 'digest')),
  delivery_hour smallint NOT NULL DEFAULT 9 CHECK (delivery_hour BETWEEN 0 AND 23),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('cashflow_plan', 'scheduled_operation', 'debt_due')),
  source_id uuid NOT NULL,
  event_date date NOT NULL,
  reminder_offset smallint NOT NULL CHECK (reminder_offset BETWEEN 0 AND 30),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL CHECK (btrim(body) <> ''),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning')),
  in_app_visible boolean NOT NULL DEFAULT true,
  read_at timestamptz,
  telegram_sent_at timestamptz,
  telegram_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id, event_date, reminder_offset)
);

CREATE INDEX app_notifications_user_unread_idx
  ON public.app_notifications(user_id, workspace_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX app_notifications_created_idx ON public.app_notifications(created_at DESC);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = notification_preferences.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active));
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = notification_preferences.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active));
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = notification_preferences.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active))
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = notification_preferences.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active));

CREATE POLICY app_notifications_select ON public.app_notifications FOR SELECT
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = app_notifications.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active));
CREATE POLICY app_notifications_update ON public.app_notifications FOR UPDATE
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = app_notifications.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active))
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = app_notifications.workspace_id AND wm.user_id = (SELECT auth.uid()) AND wm.is_active));

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT, UPDATE ON public.app_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.is_telegram_linked()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.telegram_users WHERE user_id = (SELECT auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.is_telegram_linked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_telegram_linked() TO authenticated;

COMMIT;
