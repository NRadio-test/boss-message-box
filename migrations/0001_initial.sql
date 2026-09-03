PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone_encrypted TEXT NOT NULL,
  phone_hash TEXT NOT NULL UNIQUE,
  douyin_nickname TEXT NOT NULL CHECK (length(trim(douyin_nickname)) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL CHECK (topic IN ('released_hardware', 'released_software', 'unreleased_product', 'appeal', 'other')),
  custom_topic TEXT,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  internal_status TEXT NOT NULL DEFAULT 'unprocessed'
    CHECK (internal_status IN ('unprocessed', 'pending_resolution', 'message_replied', 'livestream_replied')),
  reply_type TEXT CHECK (reply_type IN ('message', 'livestream')),
  reply_content TEXT,
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
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size < 2097152),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE otp_phone_state (
  phone_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent')),
  lease_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  last_requested_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE otp_challenges (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 6),
  consumed_at INTEGER,
  invalidated_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  operation_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (operation_key, window_started_at)
);

CREATE TABLE image_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  not_before INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_user_created ON feedback(user_id, created_at DESC);
CREATE INDEX idx_feedback_status_created ON feedback(internal_status, created_at DESC);
CREATE INDEX idx_feedback_images_feedback ON feedback_images(feedback_id);
CREATE INDEX idx_otp_challenges_phone_sent ON otp_challenges(phone_hash, sent_at DESC);
CREATE INDEX idx_otp_challenges_expiry ON otp_challenges(expires_at);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX idx_image_cleanup_due ON image_cleanup_queue(not_before, attempt_count);
