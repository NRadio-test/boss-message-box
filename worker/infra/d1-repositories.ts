import type { PublicFeedback, PublicReply, Topic } from "../../src/shared/contracts";
import type {
  CreateFeedbackInput,
  CreateFeedbackResult,
  FeedbackRepository,
  ImageCleanupRecord,
  ImageCleanupRepository,
  OtpChallengeRecord,
  OtpRepository,
  RateLimitService,
  UserRecord,
  UserRepository,
} from "../core/ports";
import { DatabaseOutcomeUnknownError } from "../core/errors";
import { HmacService } from "../security/crypto";

interface UserRow {
  id: string;
  phone_hash: string;
  douyin_nickname: string;
}

export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async findByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare("SELECT id, phone_hash, douyin_nickname FROM users WHERE phone_hash = ? LIMIT 1")
      .bind(phoneHash)
      .first<UserRow>();
    return row ? { id: row.id, phoneHash: row.phone_hash, nickname: row.douyin_nickname } : null;
  }
}

export class D1OtpRepository implements OtpRepository {
  constructor(private readonly db: D1Database) {}

  async reserveSend(input: {
    phoneHash: string;
    leaseToken: string;
    now: number;
    leaseSeconds: number;
    cooldownSeconds: number;
  }): Promise<{ reserved: true } | { reserved: false; retryAfterSeconds: number }> {
    const leaseExpiresAt = input.now + input.leaseSeconds * 1000;
    const cooldownCutoff = input.now - input.cooldownSeconds * 1000;
    const reserved = await this.db
      .prepare(
        `INSERT INTO otp_phone_state
          (phone_hash, state, lease_token, lease_expires_at, last_requested_at, last_sent_at, updated_at)
         VALUES (?, 'sending', ?, ?, ?, NULL, ?)
         ON CONFLICT(phone_hash) DO UPDATE SET
           state = 'sending', lease_token = excluded.lease_token,
           lease_expires_at = excluded.lease_expires_at,
           last_requested_at = excluded.last_requested_at, updated_at = excluded.updated_at
         WHERE (otp_phone_state.state = 'sending' AND otp_phone_state.lease_expires_at <= ?)
            OR (otp_phone_state.state = 'sent' AND otp_phone_state.last_sent_at <= ?)
         RETURNING phone_hash`,
      )
      .bind(
        input.phoneHash,
        input.leaseToken,
        leaseExpiresAt,
        input.now,
        input.now,
        input.now,
        cooldownCutoff,
      )
      .first<{ phone_hash: string }>();
    if (reserved) return { reserved: true };

    const state = await this.db
      .prepare(
        "SELECT state, lease_expires_at, last_sent_at FROM otp_phone_state WHERE phone_hash = ? LIMIT 1",
      )
      .bind(input.phoneHash)
      .first<{ state: "sending" | "sent"; lease_expires_at: number; last_sent_at: number | null }>();
    const availableAt =
      state?.state === "sent" && state.last_sent_at
        ? state.last_sent_at + input.cooldownSeconds * 1000
        : (state?.lease_expires_at ?? input.now + 1_000);
    return { reserved: false, retryAfterSeconds: Math.max(1, Math.ceil((availableAt - input.now) / 1000)) };
  }

  async commitSent(input: {
    challengeId: string;
    phoneHash: string;
    leaseToken: string;
    codeMac: string;
    nonce: string;
    now: number;
    expiresAt: number;
  }): Promise<void> {
    const validLease =
      "EXISTS (SELECT 1 FROM otp_phone_state WHERE phone_hash = ? AND state = 'sending' AND lease_token = ? AND lease_expires_at >= ?)";
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE otp_challenges SET invalidated_at = ?
           WHERE phone_hash = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND ${validLease}`,
        )
        .bind(input.now, input.phoneHash, input.phoneHash, input.leaseToken, input.now),
      this.db
        .prepare(
          `INSERT INTO otp_challenges
            (id, phone_hash, code_mac, nonce, sent_at, expires_at, attempt_count, consumed_at, invalidated_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ? WHERE ${validLease}`,
        )
        .bind(
          input.challengeId,
          input.phoneHash,
          input.codeMac,
          input.nonce,
          input.now,
          input.expiresAt,
          input.now,
          input.phoneHash,
          input.leaseToken,
          input.now,
        ),
      this.db
        .prepare(
          `UPDATE otp_phone_state SET state = 'sent', last_sent_at = ?, lease_expires_at = ?, updated_at = ?
           WHERE phone_hash = ? AND state = 'sending' AND lease_token = ? AND lease_expires_at >= ?`,
        )
        .bind(input.now, input.now, input.now, input.phoneHash, input.leaseToken, input.now),
    ]);
    if (results[1]?.meta.changes !== 1 || results[2]?.meta.changes !== 1) {
      throw new Error("OTP reservation expired before commit");
    }
  }

  async releaseReservation(phoneHash: string, leaseToken: string, now: number): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE otp_phone_state SET state = 'sent', lease_expires_at = ?, updated_at = ?
           WHERE phone_hash = ? AND lease_token = ? AND last_sent_at IS NOT NULL`,
        )
        .bind(now, now, phoneHash, leaseToken),
      this.db
        .prepare(
          "DELETE FROM otp_phone_state WHERE phone_hash = ? AND lease_token = ? AND last_sent_at IS NULL",
        )
        .bind(phoneHash, leaseToken),
    ]);
  }

  async findChallenge(challengeId: string, phoneHash: string): Promise<OtpChallengeRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, phone_hash, code_mac, nonce, sent_at, expires_at, attempt_count, consumed_at, invalidated_at
         FROM otp_challenges WHERE id = ? AND phone_hash = ? LIMIT 1`,
      )
      .bind(challengeId, phoneHash)
      .first<{
        id: string;
        phone_hash: string;
        code_mac: string;
        nonce: string;
        sent_at: number;
        expires_at: number;
        attempt_count: number;
        consumed_at: number | null;
        invalidated_at: number | null;
      }>();
    return row
      ? {
          id: row.id,
          phoneHash: row.phone_hash,
          codeMac: row.code_mac,
          nonce: row.nonce,
          sentAt: row.sent_at,
          expiresAt: row.expires_at,
          attemptCount: row.attempt_count,
          consumedAt: row.consumed_at,
          invalidatedAt: row.invalidated_at,
        }
      : null;
  }

  async recordFailedAttempt(challengeId: string, now: number): Promise<number> {
    const row = await this.db
      .prepare(
        `UPDATE otp_challenges
         SET attempt_count = attempt_count + 1,
             invalidated_at = CASE WHEN attempt_count + 1 >= 6 THEN ? ELSE invalidated_at END
         WHERE id = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND attempt_count < 6
         RETURNING attempt_count`,
      )
      .bind(now, challengeId)
      .first<{ attempt_count: number }>();
    return row?.attempt_count ?? 6;
  }
}

export class D1RateLimitService implements RateLimitService {
  private readonly hasher: HmacService;

  constructor(
    private readonly db: D1Database,
    hmacKey: string,
  ) {
    this.hasher = new HmacService(hmacKey, "RATE_LIMIT_HMAC_KEY");
  }

  async consume(input: {
    operation: string;
    identity: string;
    limit: number;
    windowSeconds: number;
    now: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const operationKey = await this.hasher.sign(`${input.operation}:${input.identity}`);
    const windowMs = input.windowSeconds * 1000;
    const windowStartedAt = Math.floor(input.now / windowMs) * windowMs;
    const result = await this.db
      .prepare(
        `INSERT INTO rate_limits (operation_key, window_started_at, request_count, expires_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(operation_key, window_started_at)
         DO UPDATE SET request_count = request_count + 1
         RETURNING request_count`,
      )
      .bind(operationKey, windowStartedAt, windowStartedAt + windowMs * 2)
      .first<{ request_count: number }>();
    const count = result?.request_count ?? input.limit + 1;
    return {
      allowed: count <= input.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + windowMs - input.now) / 1000)),
    };
  }

  async deleteExpired(now: number): Promise<void> {
    await this.db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now).run();
  }
}

export class D1FeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: D1Database) {}

  async findIdempotent(
    submissionKey: string,
    phoneHash: string,
  ): Promise<{ feedbackId: string; createdAt: number } | null> {
    const row = await this.db
      .prepare(
        `SELECT f.id, f.created_at FROM feedback f
         JOIN users u ON u.id = f.user_id
         WHERE f.submission_key = ? AND u.phone_hash = ? LIMIT 1`,
      )
      .bind(submissionKey, phoneHash)
      .first<{ id: string; created_at: number }>();
    return row ? { feedbackId: row.id, createdAt: row.created_at } : null;
  }

  async createWithUserAndConsumeOtp(input: CreateFeedbackInput): Promise<CreateFeedbackResult> {
    const existing = await this.findIdempotent(input.submissionKey, input.phoneHash);
    if (existing) return { status: "idempotent", ...existing };

    const activeChallengeSql = `EXISTS (
      SELECT 1 FROM otp_challenges c
      WHERE c.id = ? AND c.phone_hash = ? AND c.consumed_at IS NULL
        AND c.invalidated_at IS NULL AND c.expires_at >= ?
    )`;
    try {
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `INSERT INTO users (id, phone_encrypted, phone_hash, douyin_nickname, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${activeChallengeSql}
             ON CONFLICT(phone_hash) DO NOTHING`,
          )
          .bind(
            input.userId,
            input.phoneEncrypted,
            input.phoneHash,
            input.nickname,
            input.now,
            input.now,
            input.challengeId,
            input.phoneHash,
            input.now,
          ),
        this.db
          .prepare(
            `INSERT INTO feedback
              (id, submission_key, user_id, topic, custom_topic, content, internal_status,
               reply_type, reply_content, privacy_policy_version, privacy_agreed_at,
               livestream_policy_version, livestream_agreed_at, created_at, updated_at)
             SELECT ?, ?, u.id, ?, ?, ?, 'unprocessed', NULL, NULL, ?, ?, ?, ?, ?, ?
             FROM users u
             WHERE u.phone_hash = ? AND u.douyin_nickname = ? AND ${activeChallengeSql}`,
          )
          .bind(
            input.id,
            input.submissionKey,
            input.topic,
            input.customTopic,
            input.content,
            input.privacyPolicyVersion,
            input.privacyAgreedAt,
            input.livestreamPolicyVersion,
            input.livestreamAgreedAt,
            input.now,
            input.now,
            input.phoneHash,
            input.nickname,
            input.challengeId,
            input.phoneHash,
            input.now,
          ),
        ...input.images.map((image) =>
          this.db
            .prepare(
              `INSERT INTO feedback_images
                (id, feedback_id, object_key, media_type, byte_size, width, height, sha256, created_at)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM feedback WHERE id = ?`,
            )
            .bind(
              image.id,
              input.id,
              image.objectKey,
              image.mediaType,
              image.byteSize,
              image.width,
              image.height,
              image.sha256,
              input.now,
              input.id,
            ),
        ),
        this.db
          .prepare(
            `UPDATE otp_challenges SET consumed_at = ?
             WHERE id = ? AND phone_hash = ? AND consumed_at IS NULL
               AND EXISTS (SELECT 1 FROM feedback WHERE id = ?)`,
          )
          .bind(input.now, input.challengeId, input.phoneHash, input.id),
      ];
      const results = await this.db.batch(statements);
      if (results[1]?.meta.changes === 1) {
        return { status: "created", feedbackId: input.id, createdAt: input.now };
      }
    } catch (error) {
      try {
        const idempotent = await this.findIdempotent(input.submissionKey, input.phoneHash);
        if (idempotent) return { status: "idempotent", ...idempotent };
      } catch {
        throw new DatabaseOutcomeUnknownError();
      }
      throw error;
    }

    const user = await this.db
      .prepare("SELECT douyin_nickname FROM users WHERE phone_hash = ? LIMIT 1")
      .bind(input.phoneHash)
      .first<{ douyin_nickname: string }>();
    if (user && user.douyin_nickname !== input.nickname) return { status: "nickname_mismatch" };
    return { status: "otp_consumed" };
  }

  async findHistory(phoneHash: string, nickname: string): Promise<PublicFeedback[] | null> {
    const user = await this.db
      .prepare("SELECT id FROM users WHERE phone_hash = ? AND douyin_nickname = ? LIMIT 1")
      .bind(phoneHash, nickname)
      .first<{ id: string }>();
    if (!user) return null;

    const rows = await this.db
      .prepare(
        `SELECT f.id, f.topic, f.custom_topic, f.content, f.internal_status, f.reply_type,
                f.reply_content, f.created_at, f.updated_at, COUNT(i.id) AS image_count
         FROM feedback f
         LEFT JOIN feedback_images i ON i.feedback_id = f.id
         WHERE f.user_id = ?
         GROUP BY f.id
         ORDER BY f.created_at DESC`,
      )
      .bind(user.id)
      .all<{
        id: string;
        topic: Topic;
        custom_topic: string | null;
        content: string;
        internal_status: string;
        reply_type: "message" | "livestream" | null;
        reply_content: string | null;
        created_at: number;
        updated_at: number;
        image_count: number;
      }>();
    if (rows.results.length === 0) return null;
    const replyRows = await this.db
      .prepare(
        `SELECT reply.id, reply.feedback_id, reply.reply_type, reply.content, reply.created_at
           FROM feedback_replies reply
           JOIN feedback f ON f.id = reply.feedback_id
          WHERE f.user_id = ?
          ORDER BY reply.created_at ASC, reply.id ASC`,
      )
      .bind(user.id)
      .all<{
        id: string;
        feedback_id: string;
        reply_type: "live" | "message";
        content: string;
        created_at: number;
      }>();
    const repliesByFeedback = new Map<string, PublicReply[]>();
    for (const reply of replyRows.results) {
      const replies = repliesByFeedback.get(reply.feedback_id) ?? [];
      replies.push({
        id: reply.id,
        replyType: reply.reply_type,
        content: reply.content,
        createdAt: reply.created_at,
      });
      repliesByFeedback.set(reply.feedback_id, replies);
    }
    return rows.results.map((row) => {
      let replies = repliesByFeedback.get(row.id) ?? [];
      const legacyReplied =
        (row.internal_status === "message_replied" || row.internal_status === "livestream_replied") &&
        row.reply_content &&
        row.reply_type;
      if (replies.length === 0 && legacyReplied) {
        replies = [{
          id: `legacy-${row.id}`,
          replyType: row.reply_type === "livestream" ? "live" : "message",
          content: row.reply_content!,
          createdAt: row.updated_at,
        }];
      }
      const replied = replies.length > 0;
      return {
        id: row.id,
        topic: row.topic,
        customTopic: row.custom_topic,
        content: row.content,
        imageCount: Number(row.image_count),
        status: replied ? "replied" : "unreplied",
        replies,
        replyContent: replied ? replies.at(-1)?.content ?? null : null,
        createdAt: row.created_at,
      };
    });
  }
}

export class D1ImageCleanupRepository implements ImageCleanupRepository {
  constructor(private readonly db: D1Database) {}

  async enqueue(objectKeys: string[], notBefore: number, now: number): Promise<void> {
    if (objectKeys.length === 0) return;
    await this.db.batch(
      objectKeys.map((objectKey) =>
        this.db
          .prepare(
            `INSERT INTO image_cleanup_queue
              (object_key, not_before, attempt_count, last_error, created_at, updated_at)
             VALUES (?, ?, 0, NULL, ?, ?)
             ON CONFLICT(object_key) DO UPDATE SET
               not_before = MIN(image_cleanup_queue.not_before, excluded.not_before),
               updated_at = excluded.updated_at`,
          )
          .bind(objectKey, notBefore, now, now),
      ),
    );
  }

  async listDue(now: number, limit: number): Promise<ImageCleanupRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT object_key, attempt_count FROM image_cleanup_queue
         WHERE not_before <= ? ORDER BY not_before ASC LIMIT ?`,
      )
      .bind(now, limit)
      .all<{ object_key: string; attempt_count: number }>();
    return rows.results.map((row) => ({
      objectKey: row.object_key,
      attemptCount: row.attempt_count,
    }));
  }

  async isReferenced(objectKey: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 AS present FROM feedback_images WHERE object_key = ? LIMIT 1")
      .bind(objectKey)
      .first<{ present: number }>();
    return Boolean(row);
  }

  async complete(objectKey: string): Promise<void> {
    await this.db.prepare("DELETE FROM image_cleanup_queue WHERE object_key = ?").bind(objectKey).run();
  }

  async retry(
    objectKey: string,
    notBefore: number,
    errorCode: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE image_cleanup_queue
         SET attempt_count = attempt_count + 1, not_before = ?, last_error = ?, updated_at = ?
         WHERE object_key = ?`,
      )
      .bind(notBefore, errorCode.slice(0, 120), now, objectKey)
      .run();
  }
}
