BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(6);

INSERT INTO auth.users (id, email)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'owner-security@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'member-security@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, owner_id, name, is_personal)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'RLS security fixture',
  false
);

INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Owner'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Member');

INSERT INTO public.workspace_invitations (
  id, workspace_id, invited_by, invited_email, role
)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'member-security@example.test',
  'Member'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.email', 'member-security@example.test', true);

SELECT throws_ok(
  $$UPDATE public.workspace_members
    SET role = 'Owner'
    WHERE workspace_id = '20000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000002'$$,
  'P0001',
  'Участник не может изменить собственную роль или восстановить доступ',
  'member cannot promote self'
);

SELECT lives_ok(
  $$UPDATE public.workspace_members
    SET last_accessed_at = now()
    WHERE workspace_id = '20000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000002'$$,
  'member can update own last access timestamp'
);

SELECT lives_ok(
  $$UPDATE public.workspace_members
    SET is_active = false
    WHERE workspace_id = '20000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000002'$$,
  'member can leave workspace'
);

SELECT throws_ok(
  $$UPDATE public.workspace_members
    SET is_active = true
    WHERE workspace_id = '20000000-0000-0000-0000-000000000001'
      AND user_id = '10000000-0000-0000-0000-000000000002'$$,
  'P0001',
  'Участник не может изменить собственную роль или восстановить доступ',
  'member cannot reactivate self'
);

SELECT is_empty(
  $$UPDATE public.workspace_invitations
    SET role = 'Admin'
    WHERE id = '30000000-0000-0000-0000-000000000001'
    RETURNING id$$,
  'invitation recipient cannot alter invitation role'
);

SELECT throws_ok(
  $$INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'Owner'
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role$$,
  'P0001',
  'Участник не может изменить собственную роль или восстановить доступ',
  'invitation path cannot grant Owner'
);

SELECT * FROM finish();
ROLLBACK;
