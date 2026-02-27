-- Add is_archived to categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Add is_archived to tags
ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
