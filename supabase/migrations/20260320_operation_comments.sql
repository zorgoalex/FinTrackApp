-- Threaded notes for operations, including locally extracted receipt items.

BEGIN;

CREATE TABLE IF NOT EXISTS public.operation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'receipt_items')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operation_comments_operation_created_idx
  ON public.operation_comments(operation_id, created_at);
CREATE INDEX IF NOT EXISTS operation_comments_workspace_idx
  ON public.operation_comments(workspace_id);

ALTER TABLE public.operation_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operation_comments_select ON public.operation_comments;
DROP POLICY IF EXISTS operation_comments_insert ON public.operation_comments;
DROP POLICY IF EXISTS operation_comments_update ON public.operation_comments;
DROP POLICY IF EXISTS operation_comments_delete ON public.operation_comments;

CREATE POLICY operation_comments_select ON public.operation_comments FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));

CREATE POLICY operation_comments_insert ON public.operation_comments FOR INSERT
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
    AND EXISTS (
      SELECT 1 FROM public.operations operation
      WHERE operation.id = operation_id AND operation.workspace_id = workspace_id
    )
  );

CREATE POLICY operation_comments_update ON public.operation_comments FOR UPDATE
  USING (
    author_id = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  )
  WITH CHECK (
    (author_id = (SELECT auth.uid()) OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']))
    AND EXISTS (
      SELECT 1 FROM public.operations operation
      WHERE operation.id = operation_id AND operation.workspace_id = workspace_id
    )
  );

CREATE POLICY operation_comments_delete ON public.operation_comments FOR DELETE
  USING (
    author_id = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operation_comments TO authenticated;

COMMENT ON TABLE public.operation_comments IS
  'User notes and redacted receipt item summaries attached to financial operations.';

COMMIT;
