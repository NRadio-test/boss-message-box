import {
  STUDIO_PAGE_SIZE,
  type StudioFeedbackDetail,
  type StudioFeedbackImage,
  type StudioFeedbackListSuccess,
  type StudioFeedbackSummary,
  type StudioReply,
  type StudioReplyType,
  type StudioStatsSuccess,
  type StudioUserDetailSuccess,
} from "../../src/shared/studio-contracts";
import type { Topic } from "../../src/shared/contracts";
import { PublicError } from "../core/errors";
import type {
  AdminRecord,
  AdminRepository,
  AdminSessionRepository,
  StudioListInput,
  StudioRepository,
  StudioSearchInput,
  StudioSessionRecord,
} from "../core/studio-ports";

interface SummaryRow {
  id: string;
  user_id: string | null;
  douyin_nickname: string;
  topic: Topic;
  custom_topic: string | null;
  content: string;
  created_at: number;
  is_todo: number;
  image_count: number;
  reply_count: number;
  latest_reply_admin: string | null;
  moderation_status: "pending" | "kept" | "filtered" | "failed";
  moderation_category: "valid_feedback" | "abusive" | "meaningless" | "uncertain" | null;
  moderation_reason: string | null;
}

const SUMMARY_SELECT = `
  SELECT f.id, f.user_id, COALESCE(f.douyin_nickname, u.douyin_nickname) AS douyin_nickname,
         f.topic, f.custom_topic, f.content, f.created_at, f.is_todo,
         f.moderation_status, f.moderation_category, f.moderation_reason,
         (SELECT COUNT(*) FROM feedback_images image WHERE image.feedback_id = f.id) AS image_count,
         (SELECT COUNT(*) FROM feedback_replies reply WHERE reply.feedback_id = f.id) AS reply_count,
         (SELECT admin.username
            FROM feedback_replies latest
            LEFT JOIN admins admin ON admin.id = latest.admin_id
           WHERE latest.feedback_id = f.id
           ORDER BY latest.created_at DESC, latest.id DESC
           LIMIT 1) AS latest_reply_admin
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id`;

function feedbackNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function mapSummary(row: SummaryRow): StudioFeedbackSummary {
  const replyCount = Number(row.reply_count);
  const filtered = row.moderation_status === "filtered";
  return {
    id: row.id,
    feedbackNumber: feedbackNumber(row.id),
    userId: row.user_id,
    nickname: row.douyin_nickname,
    topic: row.topic,
    customTopic: row.custom_topic,
    contentPreview: row.content.slice(0, 240),
    imageCount: Number(row.image_count),
    createdAt: row.created_at,
    status: filtered ? "filtered" : replyCount > 0 ? "replied" : "unreplied",
    isTodo: !filtered && Boolean(row.is_todo) && replyCount === 0,
    replyCount,
    latestReplyAdmin: row.latest_reply_admin,
    moderationStatus: row.moderation_status,
    moderationCategory: row.moderation_category,
    moderationReason: row.moderation_reason,
  };
}

function viewFilter(view: StudioListInput["view"]): string {
  const normal = "f.moderation_status <> 'filtered'";
  switch (view) {
    case "unreplied":
      return `${normal} AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`;
    case "replied":
      return `${normal} AND EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`;
    case "live":
      return `${normal} AND EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id AND reply.reply_type = 'live')`;
    case "message":
      return `${normal} AND EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id AND reply.reply_type = 'message')`;
    case "todo":
      return `${normal} AND f.is_todo = 1 AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`;
    case "filtered":
      return "f.moderation_status = 'filtered'";
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class D1AdminRepository implements AdminRepository {
  constructor(private readonly db: D1Database) {}

  async findByUsername(username: string): Promise<AdminRecord | null> {
    const row = await this.db
      .prepare("SELECT id, username, password_hash, must_change_password FROM admins WHERE username = ? COLLATE NOCASE LIMIT 1")
      .bind(username)
      .first<{ id: string; username: string; password_hash: string; must_change_password: number }>();
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash, mustChangePassword: Boolean(row.must_change_password) } : null;
  }

  async changePassword(adminId: string, previousHash: string, nextHash: string, now: number): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare("UPDATE admins SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ? AND password_hash = ?")
        .bind(nextHash, now, adminId, previousHash),
      this.db.prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND EXISTS (SELECT 1 FROM admins WHERE id = ? AND password_hash = ?)")
        .bind(adminId, adminId, nextHash),
    ]);
    return results[0]?.meta.changes === 1;
  }

  async recordSuccessfulLogin(adminId: string, now: number): Promise<void> {
    await this.db
      .prepare("UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, adminId)
      .run();
  }
}

export class D1AdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    tokenHash: string;
    adminId: string;
    mode: "normal" | "live";
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_sessions (token_hash, admin_id, mode, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.tokenHash, input.adminId, input.mode, input.createdAt, input.expiresAt)
      .run();
  }

  async findActive(tokenHash: string, now: number): Promise<StudioSessionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT session.token_hash, session.mode, session.expires_at, admin.id, admin.username
           FROM admin_sessions session
           JOIN admins admin ON admin.id = session.admin_id
          WHERE session.token_hash = ? AND session.expires_at > ? AND admin.must_change_password = 0
          LIMIT 1`,
      )
      .bind(tokenHash, now)
      .first<{
        token_hash: string;
        mode: "normal" | "live";
        expires_at: number;
        id: string;
        username: string;
      }>();
    return row
      ? {
          tokenHash: row.token_hash,
          admin: { id: row.id, username: row.username },
          mode: row.mode,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async setMode(
    tokenHash: string,
    mode: "normal" | "live",
    now: number,
  ): Promise<StudioSessionRecord | null> {
    const result = await this.db
      .prepare("UPDATE admin_sessions SET mode = ? WHERE token_hash = ? AND expires_at > ?")
      .bind(mode, tokenHash, now)
      .run();
    if (result.meta.changes !== 1) return null;
    return this.findActive(tokenHash, now);
  }

  async delete(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  async deleteExpired(now: number): Promise<void> {
    await this.db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now).run();
  }
}

export class D1StudioRepository implements StudioRepository {
  constructor(private readonly db: D1Database) {}

  async listFeedbacks(input: StudioListInput): Promise<StudioFeedbackListSuccess> {
    const filter = viewFilter(input.view) + (input.readyOnly ? " AND f.moderation_status IN ('kept', 'failed')" : "");
    return this.listWithFilter(
      input.topic ? `(${filter}) AND f.topic = ?` : filter,
      input.topic ? [input.topic] : [],
      input.page,
      input.snapshot,
    );
  }

  async searchFeedbacks(input: StudioSearchInput): Promise<StudioFeedbackListSuccess> {
    if (input.queryType === "combined") {
      return this.listWithFilter(
        "(f.douyin_nickname LIKE ? ESCAPE '\\' OR upper(substr(f.id, 1, 8)) = ?)",
        [`%${escapeLike(input.queryValue)}%`, input.queryValue.replace(/^#/u, "").toUpperCase()],
        input.page, input.snapshot,
      );
    }
    if (input.queryType === "phone") {
      return this.listWithFilter("u.phone_hash = ?", [input.queryValue], input.page, input.snapshot);
    }
    if (input.queryType === "feedback_number") {
      return this.listWithFilter(
        "upper(substr(f.id, 1, 8)) = ?",
        [input.queryValue.toUpperCase()],
        input.page,
        input.snapshot,
      );
    }
    return this.listWithFilter(
      "COALESCE(f.douyin_nickname, u.douyin_nickname) LIKE ? ESCAPE '\\'",
      [`%${escapeLike(input.queryValue)}%`],
      input.page,
      input.snapshot,
    );
  }

  async findFeedback(feedbackId: string): Promise<StudioFeedbackDetail | null> {
    const row = await this.db
      .prepare(`${SUMMARY_SELECT} WHERE f.id = ? LIMIT 1`)
      .bind(feedbackId)
      .first<SummaryRow>();
    if (!row) return null;

    const [imagesResult, repliesResult] = await this.db.batch([
      this.db
        .prepare(
          `SELECT id, media_type, byte_size, width, height
             FROM feedback_images WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .bind(feedbackId),
      this.db
        .prepare(
          `SELECT reply.id, reply.reply_type, reply.content, reply.created_at, admin.username
             FROM feedback_replies reply
             LEFT JOIN admins admin ON admin.id = reply.admin_id
            WHERE reply.feedback_id = ?
            ORDER BY reply.created_at ASC, reply.id ASC`,
        )
        .bind(feedbackId),
    ]);
    const images = (imagesResult.results as Array<{
      id: string;
      media_type: "image/webp";
      byte_size: number;
      width: number;
      height: number;
    }>).map((image): StudioFeedbackImage => ({
      id: image.id,
      mediaType: image.media_type,
      byteSize: image.byte_size,
      width: image.width,
      height: image.height,
      viewUrl: `/api/studio/feedbacks/${encodeURIComponent(feedbackId)}/images/${encodeURIComponent(image.id)}`,
      downloadUrl: `/api/studio/feedbacks/${encodeURIComponent(feedbackId)}/images/${encodeURIComponent(image.id)}?download=1`,
    }));
    const replies = (repliesResult.results as Array<{
      id: string;
      reply_type: StudioReplyType;
      content: string;
      created_at: number;
      username: string | null;
    }>).map((reply) => this.mapReply(reply));
    return {
      ...mapSummary(row),
      content: row.content,
      maskedPhone: row.user_id ? "1**********" : null,
      images,
      replies,
    };
  }

  async appendReply(input: {
    id: string;
    feedbackId: string;
    replyType: StudioReplyType;
    content: string;
    admin: { id: string; username: string };
    now: number;
    requestKey?: string;
    liveMode?: boolean;
  }): Promise<{
    reply: StudioReply;
    replyCount: number;
    latestReplyAdmin: string | null;
  } | null> {
    if (!(await this.feedbackExists(input.feedbackId))) return null;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO feedback_replies (id, feedback_id, reply_type, content, admin_id, created_at, request_key)
           SELECT ?, id, ?, ?, ?, ?, ? FROM feedback
           WHERE id = ? AND (? = 0 OR moderation_status IN ('kept', 'failed'))
           ON CONFLICT(admin_id, request_key) DO NOTHING`,
        )
        .bind(input.id, input.replyType, input.content, input.admin.id, input.now, input.requestKey ?? null, input.feedbackId, input.liveMode ? 1 : 0),
      this.db
        .prepare(`UPDATE feedback SET is_todo = 0, updated_at = ?, moderation_attempt_token = NULL,
           moderation_status = CASE WHEN moderation_status = 'pending' THEN 'kept' ELSE moderation_status END,
           moderation_source = CASE WHEN moderation_status IN ('pending', 'failed') THEN 'manual' ELSE moderation_source END
           WHERE id = ? AND EXISTS (SELECT 1 FROM feedback_replies WHERE id = ?)`)
        .bind(input.now, input.feedbackId, input.id),
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, feedback_id, action, created_at)
           SELECT ?, ?, ?, 'reply_created', ? WHERE EXISTS (SELECT 1 FROM feedback_replies WHERE id = ?)`,
        )
        .bind(crypto.randomUUID(), input.admin.id, input.feedbackId, input.now, input.id),
    ]);
    const persisted = await this.db.prepare(`SELECT id, feedback_id, reply_type, content, created_at FROM feedback_replies
      WHERE admin_id = ? AND ${input.requestKey ? "request_key = ?" : "id = ?"} LIMIT 1`)
      .bind(input.admin.id, input.requestKey ?? input.id)
      .first<{ id: string; feedback_id: string; reply_type: StudioReplyType; content: string; created_at: number }>();
    if (!persisted) throw new PublicError(409, "FEEDBACK_NOT_READY", "留言状态已变化，请刷新后重试");
    if (persisted.feedback_id !== input.feedbackId || persisted.content !== input.content || persisted.reply_type !== input.replyType) {
      throw new PublicError(409, "REQUEST_CONFLICT", "这次回复请求已使用，请刷新后再试");
    }
    const summary = await this.getFeedbackSummary(input.feedbackId);
    if (!summary) return null;
    return {
      reply: {
        id: persisted.id,
        replyType: persisted.reply_type,
        content: persisted.content,
        adminUsername: input.admin.username,
        createdAt: persisted.created_at,
      },
      replyCount: summary.replyCount,
      latestReplyAdmin: summary.latestReplyAdmin,
    };
  }

  async setTodo(input: {
    feedbackId: string;
    isTodo: boolean;
    adminId: string;
    now: number;
  }): Promise<boolean | null> {
    const sql = input.isTodo
      ? `UPDATE feedback SET is_todo = 1, updated_at = ?
           WHERE id = ? AND is_todo = 0
             AND moderation_status <> 'filtered'
             AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = feedback.id)`
      : "UPDATE feedback SET is_todo = 0, updated_at = ? WHERE id = ? AND is_todo = 1";
    const result = await this.db.prepare(sql).bind(input.now, input.feedbackId).run();
    const summary = await this.getFeedbackSummary(input.feedbackId);
    if (!summary) return null;
    if (result.meta.changes === 1) {
      await this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, feedback_id, action, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.adminId,
          input.feedbackId,
          input.isTodo ? "todo_added" : "todo_removed",
          input.now,
        )
        .run()
        .catch((error: unknown) => {
          console.error("Unable to persist Studio audit log", {
            kind: error instanceof Error ? error.name : "UnknownError",
          });
        });
    }
    return summary.isTodo;
  }

  async findUser(userId: string): Promise<StudioUserDetailSuccess | null> {
    const user = await this.db
      .prepare(
        `SELECT u.id, u.douyin_nickname, MIN(f.created_at) AS first_feedback_at,
                COUNT(f.id) AS feedback_count
           FROM users u
           JOIN feedback f ON f.user_id = u.id
          WHERE u.id = ?
          GROUP BY u.id
          LIMIT 1`,
      )
      .bind(userId)
      .first<{
        id: string;
        douyin_nickname: string;
        first_feedback_at: number;
        feedback_count: number;
      }>();
    if (!user) return null;
    const rows = await this.db
      .prepare(`${SUMMARY_SELECT} WHERE f.user_id = ? ORDER BY f.created_at DESC, f.id DESC`)
      .bind(userId)
      .all<SummaryRow>();
    return {
      ok: true,
      user: {
        id: user.id,
        nickname: user.douyin_nickname,
        maskedPhone: "1**********",
        firstFeedbackAt: user.first_feedback_at,
        feedbackCount: Number(user.feedback_count),
      },
      feedbacks: rows.results.map(mapSummary),
    };
  }

  async findEncryptedPhone(
    userId: string,
  ): Promise<{ phoneHash: string; phoneEncrypted: string } | null> {
    const row = await this.db
      .prepare("SELECT phone_hash, phone_encrypted FROM users WHERE id = ? LIMIT 1")
      .bind(userId)
      .first<{ phone_hash: string; phone_encrypted: string }>();
    return row ? { phoneHash: row.phone_hash, phoneEncrypted: row.phone_encrypted } : null;
  }

  async getStats(todayStartedAt: number): Promise<Omit<StudioStatsSuccess, "ok">> {
    const results = await this.db.batch([
      this.db.prepare("SELECT COUNT(*) AS count FROM feedback WHERE created_at >= ?").bind(todayStartedAt),
      this.db.prepare(
        `SELECT COUNT(*) AS count FROM feedback f
          WHERE f.moderation_status <> 'filtered'
            AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`,
      ),
      this.db.prepare(
         `SELECT COUNT(*) AS count FROM feedback f
          WHERE f.is_todo = 1
            AND f.moderation_status <> 'filtered'
            AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`,
      ),
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT feedback_id) AS count FROM feedback_replies WHERE created_at >= ?`,
        )
        .bind(todayStartedAt),
    ]);
    const count = (index: number): number =>
      Number((results[index]?.results[0] as { count?: number } | undefined)?.count ?? 0);
    return {
      todayFeedback: count(0),
      unreplied: count(1),
      todo: count(2),
      todayReplied: count(3),
    };
  }

  async countNewFeedback(
    after: { createdAt: number; id: string },
    topic: Topic | null,
    readyOnly = false,
  ): Promise<number> {
    const topicFilter = topic ? " AND topic = ?" : "";
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM feedback
          WHERE moderation_status <> 'filtered'
            AND NOT EXISTS (SELECT 1 FROM feedback_replies WHERE feedback_id = feedback.id)
            ${readyOnly ? "AND moderation_status IN ('kept', 'failed')" : ""}
            AND (created_at > ? OR (created_at = ? AND id > ?))${topicFilter}`,
      )
      .bind(after.createdAt, after.createdAt, after.id, ...(topic ? [topic] : []))
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async findImage(feedbackId: string, imageId: string): Promise<{ objectKey: string; byteSize: number } | null> {
    const row = await this.db
      .prepare(
        "SELECT object_key, byte_size FROM feedback_images WHERE feedback_id = ? AND id = ? LIMIT 1",
      )
      .bind(feedbackId, imageId)
      .first<{ object_key: string; byte_size: number }>();
    return row ? { objectKey: row.object_key, byteSize: row.byte_size } : null;
  }

  async feedbackExists(feedbackId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 AS present FROM feedback WHERE id = ? LIMIT 1")
      .bind(feedbackId)
      .first<{ present: number }>();
    return Boolean(row);
  }

  async getFeedbackSummary(feedbackId: string): Promise<StudioFeedbackSummary | null> {
    const row = await this.db
      .prepare(`${SUMMARY_SELECT} WHERE f.id = ? LIMIT 1`)
      .bind(feedbackId)
      .first<SummaryRow>();
    return row ? mapSummary(row) : null;
  }

  async setModeration(input: {
    feedbackId: string;
    filtered: boolean;
    adminId: string;
    now: number;
  }): Promise<{ moderationStatus: "filtered" | "kept"; isTodo: false } | null> {
    if (!(await this.feedbackExists(input.feedbackId))) return null;
    const status = input.filtered ? "filtered" : "kept";
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE feedback
           SET moderation_status = ?, moderation_source = 'manual',
               moderation_category = NULL, moderation_reason = ?, moderated_at = ?,
               is_todo = 0, updated_at = ?, moderation_attempt_token = NULL
           WHERE id = ?`,
        )
        .bind(
          status,
          input.filtered ? "manual_filter" : "manual_restore",
          input.now,
          input.now,
          input.feedbackId,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, feedback_id, action, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.adminId,
          input.feedbackId,
          input.filtered ? "moderation_filtered" : "moderation_restored",
          input.now,
        ),
    ]);
    return results[0]?.meta.changes === 1
      ? { moderationStatus: status, isTodo: false }
      : null;
  }

  async findNextFeedback(input: {
    currentFeedbackId: string;
    view: "unreplied" | "todo";
    topic: Topic | null;
  }): Promise<string | null> {
    const current = await this.db
      .prepare("SELECT created_at, id FROM feedback WHERE id = ? LIMIT 1")
      .bind(input.currentFeedbackId)
      .first<{ created_at: number; id: string }>();
    if (!current) return null;
    const filter = viewFilter(input.view);
    const topicFilter = input.topic ? " AND f.topic = ?" : "";
    const row = await this.db
      .prepare(
        `SELECT f.id FROM feedback f
         WHERE (${filter})${topicFilter}
           AND f.moderation_status IN ('kept', 'failed')
           AND (f.created_at < ? OR (f.created_at = ? AND f.id < ?))
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT 1`,
      )
      .bind(
        ...(input.topic ? [input.topic] : []),
        current.created_at,
        current.created_at,
        current.id,
      )
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  private async listWithFilter(
    filter: string,
    filterBindings: unknown[],
    page: number,
    requestedSnapshot: { createdAt: number; id: string } | null,
  ): Promise<StudioFeedbackListSuccess> {
    const snapshot = requestedSnapshot ?? (await this.latestSnapshot());
    if (!snapshot) {
      return {
        ok: true,
        items: [],
        pagination: { page, pageSize: STUDIO_PAGE_SIZE, total: 0, totalPages: 0 },
        snapshot: null,
      };
    }
    const snapshotFilter = "(f.created_at < ? OR (f.created_at = ? AND f.id <= ?))";
    const bindings = [...filterBindings, snapshot.createdAt, snapshot.createdAt, snapshot.id];
    const where = `(${filter}) AND ${snapshotFilter}`;
    const countRow = await this.db
      .prepare(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE ${where}`)
      .bind(...bindings)
      .first<{ count: number }>();
    const total = Number(countRow?.count ?? 0);
    const rows = await this.db
      .prepare(
        `${SUMMARY_SELECT} WHERE ${where}
         ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, STUDIO_PAGE_SIZE, (page - 1) * STUDIO_PAGE_SIZE)
      .all<SummaryRow>();
    return {
      ok: true,
      items: rows.results.map(mapSummary),
      pagination: {
        page,
        pageSize: STUDIO_PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / STUDIO_PAGE_SIZE),
      },
      snapshot,
    };
  }

  private async latestSnapshot(): Promise<{ createdAt: number; id: string } | null> {
    const row = await this.db
      .prepare("SELECT created_at, id FROM feedback ORDER BY created_at DESC, id DESC LIMIT 1")
      .first<{ created_at: number; id: string }>();
    return row ? { createdAt: row.created_at, id: row.id } : null;
  }

  private mapReply(row: {
    id: string;
    reply_type: StudioReplyType;
    content: string;
    created_at: number;
    username: string | null;
  }): StudioReply {
    return {
      id: row.id,
      replyType: row.reply_type,
      content: row.content,
      adminUsername: row.username,
      createdAt: row.created_at,
    };
  }
}
