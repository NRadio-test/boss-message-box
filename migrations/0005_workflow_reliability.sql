ALTER TABLE feedback_replies ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_reply_request ON feedback_replies(admin_id, request_key);

ALTER TABLE feedback ADD COLUMN moderation_attempt_token TEXT;
ALTER TABLE feedback ADD COLUMN moderation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN moderation_next_retry_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_moderation_retry ON feedback(moderation_status, moderation_next_retry_at);

-- Existing accounts remain available. Known bootstrap passwords require rotation
-- before a session may access business data.
ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
UPDATE admins SET must_change_password = 1
WHERE password_hash IN (
  'pbkdf2-sha256$100000$nVAZexYMWbKMc86O0pGZFg$OZ2s1PzKoJcnisM1p8n_zHWnL-t80zYEfwEJjARNs-Y',
  'pbkdf2-sha256$100000$jiAxALcEdniEFcw8VxEBxA$hLDNsFYlWCGIEKu3mmJ_9Plinhzoq6XUg4SGcEXJ6e4',
  'pbkdf2-sha256$100000$vwi6vv3gga6RL-tn-JfeuA$f-p2Wg88zQTFA9_dtCYEyMeaK4ZBGqvZatO2Tbz7Ij8',
  'pbkdf2-sha256$100000$QUvTs5NL9IJQFZvp0N0wXQ$RaiWw0DYKVoXD1VGMRdv_yPuJcifzNC7MhRognnoiaY',
  'pbkdf2-sha256$600000$IRY_0FQTJoY3tz7Fkvo8Mg$onvF3XB3GXlr4_I81BNqMuiuncJtXjXcKVyceVNSWo4',
  'pbkdf2-sha256$600000$NsgP1261mf9kceKig7j8Ww$P2sd9vQKIuzM4Bju30QQL1TFeiRr8z2ulZu1-Mh_eLc',
  'pbkdf2-sha256$600000$fUiz_JwwF8WI5HSbZjpFmg$XeiIxt89c28KzvaNYBmT9tNTLiUXX3OpiJoPeJdOQEM',
  'pbkdf2-sha256$600000$pw09W_uxbQwi89YHRXgIyQ$CJPSCduoxBU9ftkdIs73B38N5PpHtMdzQv_6Z4fFt_M'
);
DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE must_change_password = 1);
