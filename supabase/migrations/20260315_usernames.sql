-- Unique account usernames used as an alternative login identifier.

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[[:alnum:]_]{3,30}$'),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_username_lower_unique ON public.profiles(lower(username));

CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_username text;
  explicit_username boolean;
BEGIN
  explicit_username := NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), '') IS NOT NULL;
  requested_username := COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), ''), split_part(NEW.email, '@', 1));
  requested_username := regexp_replace(requested_username, '[^[:alnum:]_]', '_', 'g');
  IF length(requested_username) < 3 THEN requested_username := 'user_' || left(NEW.id::text, 8); END IF;

  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (
    NEW.id,
    CASE
      WHEN explicit_username THEN left(requested_username, 30)
      ELSE left(requested_username, 21) || '_' || left(NEW.id::text, 8)
    END,
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_profile_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();

INSERT INTO public.profiles (user_id, username, display_name)
SELECT
  u.id,
  left(regexp_replace(split_part(u.email, '@', 1), '[^[:alnum:]_]', '_', 'g'), 21) || '_' || left(u.id::text, 8),
  NULLIF(btrim(u.raw_user_meta_data ->> 'name'), '')
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.profiles TO authenticated;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
