-- Add decline support to the online-signing flow.
--
-- Until now a signing session could only end in one of three states:
--   * open    (signed_at IS NULL AND expires_at > now())
--   * signed  (signed_at IS NOT NULL)
--   * expired (signed_at IS NULL AND expires_at <= now())
--
-- This migration adds a fourth terminal state, "declined", so the
-- recipient can explicitly reject the document with a reason
-- instead of just abandoning the link. The sender then sees the
-- rejection note in the in-app DocumentsTab and can resend a
-- corrected version.
--
-- Keeping the columns nullable (instead of using a status enum)
-- means existing rows continue to behave identically — only newly
-- declined sessions populate these fields.

ALTER TABLE "signing_sessions"
  ADD COLUMN IF NOT EXISTS "declined_at" timestamp;

ALTER TABLE "signing_sessions"
  ADD COLUMN IF NOT EXISTS "decline_reason" text;
