// supabase/functions/_shared/email-config.ts
export const emailConfig = {
  provider: 'resend', // or 'sendgrid'
  apiKey: Deno.env.get('RESEND_API_KEY'), // Using a more specific ENV var name
  fromEmail: Deno.env.get('INVITATION_FROM_EMAIL')?.trim() ?? '',
  fromName: Deno.env.get('EMAIL_FROM_NAME')?.trim() || 'FinTrackApp'
};
