# Authentication provider decision

Decision: use **WorkOS through the Supabase Auth OAuth provider**, not direct third-party JWT authentication.

## Why WorkOS

- AuthKit includes social login, MFA, passkeys, identity linking, organizations and RBAC.
- User management is free up to 1 million monthly active users; additional 1 million MAU costs $2,500/month.
- Enterprise SAML/OIDC SSO is priced per customer connection: $125/month for the first 15 connections, with volume discounts.
- The organizations and membership model matches FinTrackApp's business workspaces and future B2B direction.

Auth0 remains a capable, mature CIAM platform with a larger ecosystem and deeper extensibility. Its free plan is limited to 25,000 external active users, and organization/account-linking capabilities depend on the selected paid tier. It is a better fit when Auth0-specific Actions, Marketplace integrations, private deployments or complex CIAM customization are hard requirements.

Official sources:

- https://workos.com/pricing
- https://workos.com/docs/authkit/overview
- https://auth0.com/pricing
- https://supabase.com/docs/guides/auth/social-login/auth-workos
- https://supabase.com/docs/guides/auth/third-party/overview

## Why not replace Supabase Auth now

The current database uses UUID references to `auth.users`, `auth.uid()` in RLS policies, authentication triggers and Supabase sessions throughout the frontend and Edge Functions. Direct WorkOS or Auth0 JWT subjects use an external identity namespace, so replacing Supabase Auth would require a broad identity migration.

Using WorkOS as a Supabase OAuth provider keeps Supabase as the session issuer. A first social login creates or links a normal Supabase user, so existing UUID foreign keys, personal-workspace trigger and RLS continue to work.

## Production activation

1. Create a WorkOS production environment and configure the required social connections.
2. In Supabase Dashboard open Authentication → Sign In / Providers → WorkOS.
3. Enable WorkOS and enter its Client ID and API key. Keep these secrets only in WorkOS/Supabase dashboards.
4. Copy the Supabase callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) into WorkOS Redirects.
5. Add the application URLs to the Supabase redirect allow list:
   - `https://fintrackapp-wheat.vercel.app/workspaces`
   - `http://127.0.0.1:5173/workspaces`
6. In Vercel set:
   - `VITE_WORKOS_AUTH_ENABLED=true`
   - `VITE_WORKOS_CONNECTION_ID=<WorkOS connection ID>`
7. Set the same two values in `.env.local` for local testing and redeploy/restart the frontend.

The WorkOS API key and OAuth secret must never be stored in Vercel `VITE_*` variables or committed to Git.
