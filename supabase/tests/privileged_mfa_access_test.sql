BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(7);

INSERT INTO auth.users(id,email) VALUES
  ('1b000000-0000-0000-0000-000000000001','mfa-owner@example.test'),
  ('1b000000-0000-0000-0000-000000000002','mfa-member@example.test');
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type,base_currency)
VALUES ('2b000000-0000-0000-0000-000000000001','1b000000-0000-0000-0000-000000000001','MFA fixture',false,'business','KZT');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
  ('2b000000-0000-0000-0000-000000000001','1b000000-0000-0000-0000-000000000001','Owner'),
  ('2b000000-0000-0000-0000-000000000001','1b000000-0000-0000-0000-000000000002','Member');
INSERT INTO public.operations(
  id,workspace_id,user_id,account_id,amount,type,description,operation_date,
  currency,exchange_rate,base_amount
)
VALUES (
  '3b000000-0000-0000-0000-000000000001',
  '2b000000-0000-0000-0000-000000000001',
  '1b000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.accounts WHERE workspace_id='2b000000-0000-0000-0000-000000000001' AND is_default),
  100,
  'income',
  'MFA protected',
  CURRENT_DATE,
  'KZT',
  1,
  100
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','1b000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','1b000000-0000-0000-0000-000000000001','role','authenticated','aal','aal1',
  'amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint))
)::text,true);
SELECT ok(public.current_user_requires_workspace_mfa(),'owner is marked as requiring MFA');
SELECT is((SELECT count(*)::integer FROM public.operations),0,'AAL1 owner cannot read workspace finances');
SELECT is((SELECT count(*)::integer FROM public.workspace_members),0,'AAL1 owner cannot read workspace membership');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub','1b000000-0000-0000-0000-000000000001','role','authenticated','aal','aal2',
  'amr',json_build_array(json_build_object('method','mfa/phone','timestamp',extract(epoch FROM now())::bigint))
)::text,true);
SELECT is((SELECT count(*)::integer FROM public.operations),0,'non-TOTP AAL2 does not unlock privileged finances');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub','1b000000-0000-0000-0000-000000000001','role','authenticated','aal','aal2',
  'amr',json_build_array(json_build_object('method','mfa/totp','timestamp',extract(epoch FROM now())::bigint))
)::text,true);
SELECT is((SELECT count(*)::integer FROM public.operations),1,'AAL2 owner can read workspace finances');

SELECT set_config('request.jwt.claim.sub','1b000000-0000-0000-0000-000000000002',true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','1b000000-0000-0000-0000-000000000002','role','authenticated','aal','aal1',
  'amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint))
)::text,true);
SELECT ok(
  public.current_user_requires_workspace_mfa(),
  'member still requires MFA because every user owns a personal workspace'
);
SELECT is((SELECT count(*)::integer FROM public.operations),1,'AAL1 member keeps normal workspace access');

SELECT * FROM finish();
ROLLBACK;
