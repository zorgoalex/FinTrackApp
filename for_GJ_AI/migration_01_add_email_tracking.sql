-- Migration to add email tracking columns to workspace_invitations
-- As per Phase 2.1 Invitations Plan

ALTER TABLE public.workspace_invitations
ADD COLUMN email_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN email_sent_count INTEGER DEFAULT 0,
ADD COLUMN last_reminded_at TIMESTAMP WITH TIME ZONE;

-- Add a comment to the table to signify the update
COMMENT ON TABLE public.workspace_invitations IS 'Extended with email tracking columns for Phase 2.1';
