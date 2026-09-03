PRAGMA foreign_keys = ON;

ALTER TABLE feedback
  ADD COLUMN is_todo INTEGER NOT NULL DEFAULT 0 CHECK (is_todo IN (0, 1));

UPDATE feedback
SET is_todo = 1
WHERE internal_status = 'pending_resolution';

CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE
    CHECK (length(trim(username)) BETWEEN 1 AND 40),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'live')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
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
  action TEXT NOT NULL CHECK (action IN ('reply_created', 'todo_added', 'todo_removed')),
  created_at INTEGER NOT NULL
);

INSERT INTO admins (id, username, password_hash, created_at, updated_at, last_login_at)
VALUES
  ('admin-zd', 'zd', 'pbkdf2-sha256$600000$IRY_0FQTJoY3tz7Fkvo8Mg$onvF3XB3GXlr4_I81BNqMuiuncJtXjXcKVyceVNSWo4', unixepoch() * 1000, unixepoch() * 1000, NULL),
  ('admin-mm', 'mm', 'pbkdf2-sha256$600000$NsgP1261mf9kceKig7j8Ww$P2sd9vQKIuzM4Bju30QQL1TFeiRr8z2ulZu1-Mh_eLc', unixepoch() * 1000, unixepoch() * 1000, NULL),
  ('admin-fa', 'fa', 'pbkdf2-sha256$600000$fUiz_JwwF8WI5HSbZjpFmg$XeiIxt89c28KzvaNYBmT9tNTLiUXX3OpiJoPeJdOQEM', unixepoch() * 1000, unixepoch() * 1000, NULL),
  ('admin-ceshi', 'ceshi', 'pbkdf2-sha256$600000$pw09W_uxbQwi89YHRXgIyQ$CJPSCduoxBU9ftkdIs73B38N5PpHtMdzQv_6Z4fFt_M', unixepoch() * 1000, unixepoch() * 1000, NULL);

INSERT INTO feedback_replies (id, feedback_id, reply_type, content, admin_id, created_at)
SELECT
  'legacy-' || id,
  id,
  CASE reply_type WHEN 'livestream' THEN 'live' ELSE 'message' END,
  reply_content,
  NULL,
  updated_at
FROM feedback
WHERE reply_content IS NOT NULL AND reply_type IS NOT NULL;

CREATE TABLE feedback_images_new (
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

INSERT INTO feedback_images_new
  (id, feedback_id, object_key, media_type, byte_size, width, height, sha256, created_at)
SELECT id, feedback_id, object_key, media_type, byte_size, width, height, sha256, created_at
FROM feedback_images;

DROP TABLE feedback_images;
ALTER TABLE feedback_images_new RENAME TO feedback_images;

CREATE INDEX idx_feedback_images_feedback ON feedback_images(feedback_id);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC, id DESC);
CREATE INDEX idx_feedback_todo_created ON feedback(is_todo, created_at DESC, id DESC);
CREATE INDEX idx_feedback_receipt_number ON feedback(upper(substr(id, 1, 8)));
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX idx_feedback_replies_feedback_created ON feedback_replies(feedback_id, created_at, id);
CREATE INDEX idx_feedback_replies_feedback_type ON feedback_replies(feedback_id, reply_type);
CREATE INDEX idx_feedback_replies_created ON feedback_replies(created_at, feedback_id);
CREATE INDEX idx_audit_logs_feedback_created ON audit_logs(feedback_id, created_at);

