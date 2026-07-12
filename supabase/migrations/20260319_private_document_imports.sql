-- Privacy-first document imports. Original files and OCR text never enter the database.

BEGIN;

CREATE TABLE IF NOT EXISTS public.import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('pdf', 'image', 'csv')),
  bank text NOT NULL DEFAULT 'unknown',
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  detected_count integer NOT NULL DEFAULT 0 CHECK (detected_count >= 0),
  confirmed_count integer NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  privacy_mode text NOT NULL DEFAULT 'local-redacted' CHECK (privacy_mode = 'local-redacted'),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'partial')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_sessions_workspace_created_idx
  ON public.import_sessions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_sessions_document_hash_idx
  ON public.import_sessions(workspace_id, document_hash);

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS import_session_id uuid REFERENCES public.import_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_fingerprint text,
  ADD COLUMN IF NOT EXISTS import_confidence numeric(4,3);

ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_import_fingerprint_check;
ALTER TABLE public.operations ADD CONSTRAINT operations_import_fingerprint_check
  CHECK (import_fingerprint IS NULL OR import_fingerprint ~ '^[a-f0-9]{64}$');
ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_import_confidence_check;
ALTER TABLE public.operations ADD CONSTRAINT operations_import_confidence_check
  CHECK (import_confidence IS NULL OR import_confidence BETWEEN 0 AND 1);

CREATE INDEX IF NOT EXISTS operations_import_fingerprint_idx
  ON public.operations(workspace_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_sessions_select ON public.import_sessions;
DROP POLICY IF EXISTS import_sessions_insert ON public.import_sessions;
DROP POLICY IF EXISTS import_sessions_update ON public.import_sessions;
CREATE POLICY import_sessions_select ON public.import_sessions FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY import_sessions_insert ON public.import_sessions FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
  );
CREATE POLICY import_sessions_update ON public.import_sessions FOR UPDATE
  USING (created_by = (SELECT auth.uid()) OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (created_by = (SELECT auth.uid()) OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']));

GRANT SELECT, INSERT, UPDATE ON public.import_sessions TO authenticated;

COMMENT ON TABLE public.import_sessions IS
  'Metadata-only audit of local document imports. Never stores filenames, files, OCR text, account numbers or personal data.';

COMMIT;
