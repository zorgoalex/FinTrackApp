-- =====================================
-- Phase 3: Operations table, indexes, trigger, and RLS policies
-- =====================================

CREATE TABLE public.operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    amount numeric(15,2) NOT NULL CHECK (amount > 0),
    type text NOT NULL CHECK (type IN ('income', 'expense', 'salary')),
    description text,
    operation_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_operations_workspace_date
    ON public.operations (workspace_id, operation_date DESC);

CREATE INDEX idx_operations_workspace_type_date
    ON public.operations (workspace_id, type, operation_date DESC);

CREATE INDEX idx_operations_user_not_null
    ON public.operations (user_id)
    WHERE user_id IS NOT NULL;

CREATE TRIGGER update_operations_updated_at
    BEFORE UPDATE ON public.operations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operations_select_policy"
    ON public.operations
    AS PERMISSIVE
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = operations.workspace_id
              AND wm.user_id = auth.uid()
              AND wm.is_active = true
        )
    );

CREATE POLICY "operations_insert_policy"
    ON public.operations
    AS PERMISSIVE
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND user_has_role(
            auth.uid(),
            workspace_id,
            ARRAY['Owner'::text, 'Admin'::text, 'Member'::text]
        )
    );

CREATE POLICY "operations_update_policy"
    ON public.operations
    AS PERMISSIVE
    FOR UPDATE
    USING (
        user_has_role(
            auth.uid(),
            workspace_id,
            ARRAY['Owner'::text, 'Admin'::text]
        )
        OR (
            user_has_role(
                auth.uid(),
                workspace_id,
                ARRAY['Member'::text]
            )
            AND user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_has_role(
            auth.uid(),
            workspace_id,
            ARRAY['Owner'::text, 'Admin'::text]
        )
        OR (
            user_has_role(
                auth.uid(),
                workspace_id,
                ARRAY['Member'::text]
            )
            AND user_id = auth.uid()
        )
    );

CREATE POLICY "operations_delete_policy"
    ON public.operations
    AS PERMISSIVE
    FOR DELETE
    USING (
        user_has_role(
            auth.uid(),
            workspace_id,
            ARRAY['Owner'::text, 'Admin'::text]
        )
        OR (
            user_has_role(
                auth.uid(),
                workspace_id,
                ARRAY['Member'::text]
            )
            AND user_id = auth.uid()
        )
    );
