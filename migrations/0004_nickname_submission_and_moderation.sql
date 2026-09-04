PRAGMA foreign_keys = ON;

-- This release intentionally resets all public/user data. Studio administrator
-- accounts remain, while active sessions are cleared so the new schema starts cleanly.
DELETE FROM admin_sessions;
UPDATE image_cleanup_queue
SET not_before = 0, updated_at = unixepoch() * 1000;
INSERT OR IGNORE INTO image_cleanup_queue
  (object_key, not_before, attempt_count, last_error, created_at, updated_at)
SELECT object_key, 0, 0, NULL, unixepoch() * 1000, unixepoch() * 1000
FROM feedback_images;

DROP TABLE audit_logs;
DROP TABLE feedback_replies;
DROP TABLE feedback_images;
DROP TABLE feedback;

DELETE FROM users;
DELETE FROM otp_challenges;
DELETE FROM otp_phone_state;
DELETE FROM rate_limits;

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  douyin_nickname TEXT NOT NULL
    CHECK (length(trim(douyin_nickname)) BETWEEN 1 AND 40),
  topic TEXT NOT NULL
    CHECK (topic IN ('released_hardware', 'released_software', 'unreleased_product', 'appeal', 'other')),
  custom_topic TEXT,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  internal_status TEXT NOT NULL DEFAULT 'unprocessed'
    CHECK (internal_status IN ('unprocessed', 'pending_resolution', 'message_replied', 'livestream_replied')),
  reply_type TEXT CHECK (reply_type IN ('message', 'livestream')),
  reply_content TEXT,
  is_todo INTEGER NOT NULL DEFAULT 0 CHECK (is_todo IN (0, 1)),
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'kept', 'filtered', 'failed')),
  moderation_source TEXT
    CHECK (moderation_source IN ('ai', 'manual')),
  moderation_category TEXT
    CHECK (moderation_category IN ('valid_feedback', 'abusive', 'meaningless', 'uncertain')),
  moderation_reason TEXT CHECK (moderation_reason IS NULL OR length(moderation_reason) <= 160),
  moderated_at INTEGER,
  privacy_policy_version TEXT NOT NULL,
  privacy_agreed_at INTEGER NOT NULL,
  livestream_policy_version TEXT NOT NULL,
  livestream_agreed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (topic = 'other' AND custom_topic IS NOT NULL AND length(trim(custom_topic)) BETWEEN 1 AND 60)
    OR (topic <> 'other' AND custom_topic IS NULL)
  ),
  CHECK (
    (internal_status IN ('unprocessed', 'pending_resolution') AND reply_type IS NULL AND reply_content IS NULL)
    OR (internal_status = 'message_replied' AND reply_type = 'message' AND reply_content IS NOT NULL AND length(trim(reply_content)) > 0)
    OR (internal_status = 'livestream_replied' AND reply_type = 'livestream' AND reply_content IS NOT NULL AND length(trim(reply_content)) > 0)
  )
);

CREATE TABLE feedback_images (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type = 'image/webp'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE feedback_replies (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  reply_type TEXT NOT NULL CHECK (reply_type IN ('live', 'message')),
  content TEXT NOT NULL,
  admin_id TEXT REFERENCES admins(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK (
    (admin_id IS NULL AND length(trim(content)) > 0)
    OR (admin_id IS NOT NULL AND length(trim(content)) BETWEEN 1 AND 2000)
  )
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  feedback_id TEXT REFERENCES feedback(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'reply_created',
      'todo_added',
      'todo_removed',
      'moderation_filtered',
      'moderation_restored'
    )
  ),
  created_at INTEGER NOT NULL
);

CREATE TABLE nickname_daily_limits (
  nickname TEXT NOT NULL,
  beijing_day TEXT NOT NULL,
  submission_count INTEGER NOT NULL CHECK (submission_count BETWEEN 1 AND 10),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (nickname, beijing_day)
);

CREATE INDEX idx_feedback_created ON feedback(created_at DESC, id DESC);
CREATE INDEX idx_feedback_nickname_created ON feedback(douyin_nickname, created_at DESC, id DESC);
CREATE INDEX idx_feedback_moderation_created ON feedback(moderation_status, created_at DESC, id DESC);
CREATE INDEX idx_feedback_todo_created ON feedback(is_todo, moderation_status, created_at DESC, id DESC);
CREATE INDEX idx_feedback_receipt_number ON feedback(upper(substr(id, 1, 8)));
CREATE INDEX idx_feedback_images_feedback ON feedback_images(feedback_id);
CREATE INDEX idx_feedback_replies_feedback_created ON feedback_replies(feedback_id, created_at, id);
CREATE INDEX idx_feedback_replies_feedback_type ON feedback_replies(feedback_id, reply_type);
CREATE INDEX idx_feedback_replies_created ON feedback_replies(created_at, feedback_id);
CREATE INDEX idx_audit_logs_feedback_created ON audit_logs(feedback_id, created_at);
CREATE INDEX idx_nickname_daily_limits_updated ON nickname_daily_limits(updated_at);
