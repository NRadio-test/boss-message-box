import type { ModerationJob, ModerationJobRepository } from "../core/ports";

export const MODERATION_MAX_ATTEMPTS = 3;
export const MODERATION_LEASE_MS = 45_000;

const ELIGIBLE = `moderation_status IN ('pending', 'failed')
  AND COALESCE(moderation_source, '') <> 'manual'
  AND NOT EXISTS (SELECT 1 FROM feedback_replies WHERE feedback_id = feedback.id)`;

export class D1ModerationJobRepository implements ModerationJobRepository {
  constructor(private readonly db: D1Database) {}

  async claim(input: { feedbackId: string; now: number; manual?: boolean }): Promise<ModerationJob | null> {
    const attemptToken = crypto.randomUUID();
    const result = await this.db.prepare(
      `UPDATE feedback SET moderation_attempt_token = ?, moderation_status = 'pending',
         moderation_attempts = CASE WHEN ? = 1 THEN 1 ELSE moderation_attempts + 1 END,
         moderation_next_retry_at = ?
       WHERE id = ? AND ${ELIGIBLE}
         AND (moderation_attempt_token IS NULL OR moderation_next_retry_at <= ?)
         AND (? = 1 OR (moderation_attempts < ? AND moderation_next_retry_at <= ?))`,
    ).bind(
      attemptToken, input.manual ? 1 : 0, input.now + MODERATION_LEASE_MS,
      input.feedbackId, input.now, input.manual ? 1 : 0, MODERATION_MAX_ATTEMPTS, input.now,
    ).run();
    if (result.meta.changes !== 1) return null;

    const row = await this.db.prepare(
      `SELECT id, moderation_attempts, COALESCE(custom_topic, topic) AS topic, content
       FROM feedback WHERE id = ? AND moderation_attempt_token = ? AND ${ELIGIBLE}`,
    ).bind(input.feedbackId, attemptToken).first<{
      id: string; moderation_attempts: number; topic: string; content: string;
    }>();
    return row ? {
      feedbackId: row.id, attemptToken, attempts: row.moderation_attempts,
      topic: row.topic, content: row.content,
    } : null;
  }

  async listDue(now: number, limit: number): Promise<string[]> {
    const rows = await this.db.prepare(
      `SELECT id FROM feedback WHERE ${ELIGIBLE}
       AND moderation_attempts < ? AND moderation_next_retry_at <= ?
       ORDER BY moderation_next_retry_at, created_at, id LIMIT ?`,
    ).bind(MODERATION_MAX_ATTEMPTS, now, Math.max(1, Math.min(5, Math.floor(limit)))).all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  async expireExhausted(now: number): Promise<void> {
    await this.db.prepare(
      `UPDATE feedback SET moderation_status = 'failed', moderation_source = 'ai',
         moderation_category = NULL, moderation_reason = 'worker_interrupted',
         moderated_at = ?, updated_at = ?, moderation_attempt_token = NULL
       WHERE ${ELIGIBLE} AND moderation_attempts >= ? AND moderation_next_retry_at <= ?
         AND (moderation_attempt_token IS NOT NULL OR moderation_status = 'pending')`,
    ).bind(now, now, MODERATION_MAX_ATTEMPTS, now).run();
  }
}
