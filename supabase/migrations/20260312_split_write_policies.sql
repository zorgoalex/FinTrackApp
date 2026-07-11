-- Avoid overlapping permissive SELECT policies created by FOR ALL policies.

DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_insert ON public.categories
  FOR INSERT
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']));
CREATE POLICY categories_update ON public.categories
  FOR UPDATE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']));
CREATE POLICY categories_delete ON public.categories
  FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']));

DROP POLICY IF EXISTS tags_write ON public.tags;
CREATE POLICY tags_insert ON public.tags
  FOR INSERT
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']));
CREATE POLICY tags_update ON public.tags
  FOR UPDATE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']));
CREATE POLICY tags_delete ON public.tags
  FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']));
