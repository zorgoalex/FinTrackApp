-- Categories and tags attached to operations. Kept after the operations
-- migration because operation_tags has a foreign key to operations.

ALTER TABLE public.operations
  ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX idx_operations_workspace_category_date
  ON public.operations (workspace_id, category_id, operation_date DESC);

CREATE TABLE public.operation_tags (
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (operation_id, tag_id)
);

CREATE INDEX idx_operation_tags_tag ON public.operation_tags (tag_id);
ALTER TABLE public.operation_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY operation_tags_select ON public.operation_tags FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.operations o
    WHERE o.id = operation_id
      AND public.is_workspace_member(auth.uid(), o.workspace_id)
  )
);

CREATE POLICY operation_tags_insert ON public.operation_tags FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.operations o
    JOIN public.tags t ON t.id = tag_id AND t.workspace_id = o.workspace_id
    WHERE o.id = operation_id
      AND (
        public.user_has_role(auth.uid(), o.workspace_id, ARRAY['Owner', 'Admin'])
        OR (public.user_has_role(auth.uid(), o.workspace_id, ARRAY['Member']) AND o.user_id = auth.uid())
      )
  )
);

CREATE POLICY operation_tags_delete ON public.operation_tags FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM public.operations o
    WHERE o.id = operation_id
      AND (
        public.user_has_role(auth.uid(), o.workspace_id, ARRAY['Owner', 'Admin'])
        OR (public.user_has_role(auth.uid(), o.workspace_id, ARRAY['Member']) AND o.user_id = auth.uid())
      )
  )
);

GRANT SELECT, INSERT, DELETE ON public.operation_tags TO authenticated, service_role;
