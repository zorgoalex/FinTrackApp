-- Product scope correction: FinTrackApp is not an asset registry, inventory,
-- fixed-assets accounting or depreciation system. Keep the synced dashboard,
-- remove the net-worth domain and its dashboard footprint.

BEGIN;

UPDATE public.dashboard_preferences
SET widget_order = array_remove(widget_order, 'net_worth'),
    hidden_widgets = array_remove(hidden_widgets, 'net_worth'),
    widget_sizes = widget_sizes - 'net_worth',
    widget_settings = widget_settings - 'net_worth';

ALTER TABLE public.dashboard_preferences
  ALTER COLUMN widget_order SET DEFAULT ARRAY['summary','accounts','debts','recent_operations'];

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_data.conname
    FROM pg_constraint constraint_data
    WHERE constraint_data.conrelid = 'public.dashboard_preferences'::regclass
      AND constraint_data.contype = 'c'
      AND pg_get_constraintdef(constraint_data.oid) LIKE '%net_worth%'
  LOOP
    EXECUTE format('ALTER TABLE public.dashboard_preferences DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE public.dashboard_preferences
  ADD CONSTRAINT dashboard_preferences_widget_order_allowed
    CHECK (widget_order <@ ARRAY['summary','accounts','debts','recent_operations']::text[]),
  ADD CONSTRAINT dashboard_preferences_hidden_widgets_allowed
    CHECK (hidden_widgets <@ ARRAY['summary','accounts','debts','recent_operations']::text[]);

DROP FUNCTION IF EXISTS public.get_net_worth_history(uuid,date,date,text);
DROP FUNCTION IF EXISTS public.get_net_worth_report(uuid,date);

DROP TABLE IF EXISTS public.net_worth_goals CASCADE;
DROP TABLE IF EXISTS public.net_worth_valuations CASCADE;
DROP TABLE IF EXISTS public.net_worth_items CASCADE;

DROP FUNCTION IF EXISTS public.record_net_worth_valuation();
DROP FUNCTION IF EXISTS public.prepare_net_worth_item();

COMMIT;
