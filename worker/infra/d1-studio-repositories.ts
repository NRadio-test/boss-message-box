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
  user_id: string;
  douyin_nickname: string;
  topic: Topic;
  custom_topic: string | null;
  content: string;
  created_at: number;
  is_todo: number;
  image_count: number;
  reply_count: number;
  latest_reply_admin: string | null;
}

const SUMMARY_SELECT = `
  SELECT f.id, f.user_id, u.douyin_nickname, f.topic, f.custom_topic, f.content,
         f.created_at, f.is_todo,
         (SELECT COUNT(*) FROM feedback_images image WHERE image.feedback_id = f.id) AS image_count,
         (SELECT COUNT(*) FROM feedback_replies reply WHERE reply.feedback_id = f.id) AS reply_count,
         (SELECT admin.username
            FROM feedback_replies latest
            LEFT JOIN admins admin ON admin.id = latest.admin_id
           WHERE latest.feedback_id = f.id
           ORDER BY latest.created_at DESC, latest.id DESC
           LIMIT 1) AS latest_reply_admin
    FROM feedback f
    JOIN users u ON u.id = f.user_id`;

function feedbackNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function mapSummary(row: SummaryRow): StudioFeedbackSummary {
  const replyCount = Number(row.reply_count);
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
    status: replyCount > 0 ? "replied" : "unreplied",
    isTodo: Boolean(row.is_todo) && replyCount === 0,
    replyCount,
    latestReplyAdmin: row.latest_reply_admin,
  };
}

function viewFilter(view: StudioListInput["view"]): string {
  switch (view) {
    case "unreplied":
      return "NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)";
    case "replied":
      return "EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)";
    case "live":
      return "EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id AND reply.reply_type = 'live')";
    case "message":
      return "EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id AND reply.reply_type = 'message')";
    case "todo":
      return "f.is_todo = 1 AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)";
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class D1AdminRepository implements AdminRepository {
  constructor(private readonly db: D1Database) {}

  async findByUsername(username: string): Promise<AdminRecord | null> {
    const row = await this.db
      .prepare("SELECT id, username, password_hash FROM admins WHERE username = ? COLLATE NOCASE LIMIT 1")
      .bind(username)
      .first<{ id: string; username: string; password_hash: string }>();
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : null;
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
          WHERE session.token_hash = ? AND session.expires_at > ?
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
    const filter = viewFilter(input.view);
    return this.listWithFilter(
      input.topic ? `(${filter}) AND f.topic = ?` : filter,
      input.topic ? [input.topic] : [],
      input.page,
      input.snapshot,
    );
  }

  async searchFeedbacks(input: StudioSearchInput): Promise<StudioFeedbackListSuccess> {
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
      "u.douyin_nickname LIKE ? ESCAPE '\\'",
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
      maskedPhone: "1**********",
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
  }): Promise<{
    reply: StudioReply;
    replyCount: number;
    latestReplyAdmin: string | null;
  } | null> {
    if (!(await this.feedbackExists(input.feedbackId))) return null;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO feedback_replies (id, feedback_id, reply_type, content, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(input.id, input.feedbackId, input.replyType, input.content, input.admin.id, input.now),
      this.db
        .prepare("UPDATE feedback SET is_todo = 0, updated_at = ? WHERE id = ?")
        .bind(input.now, input.feedbackId),
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, feedback_id, action, created_at)
           VALUES (?, ?, ?, 'reply_created', ?)`,
        )
        .bind(crypto.randomUUID(), input.admin.id, input.feedbackId, input.now),
    ]);
    if (results[0]?.meta.changes !== 1) return null;
    const summary = await this.getFeedbackSummary(input.feedbackId);
    if (!summary) return null;
    return {
      reply: {
        id: input.id,
        replyType: input.replyType,
        content: input.content,
        adminUsername: input.admin.username,
        createdAt: input.now,
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
          WHERE NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`,
      ),
      this.db.prepare(
        `SELECT COUNT(*) AS count FROM feedback f
          WHERE f.is_todo = 1
            AND NOT EXISTS (SELECT 1 FROM feedback_replies reply WHERE reply.feedback_id = f.id)`,
      ),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM (
             SELECT feedback_id FROM feedback_replies
             GROUP BY feedback_id HAVING MIN(created_at) >= ?
           )`,
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
  ): Promise<number> {
    const topicFilter = topic ? " AND topic = ?" : "";
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM feedback
          WHERE (created_at > ? OR (created_at = ? AND id > ?))${topicFilter}`,
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
      .prepare(`SELECT COUNT(*) AS count FROM feedback f JOIN users u ON u.id = f.user_id WHERE ${where}`)
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
