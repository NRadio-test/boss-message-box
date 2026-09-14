import type { LiveBatch, LiveEntry, LiveListSuccess } from "../../src/shared/live-contracts";
import { STUDIO_PAGE_SIZE } from "../../src/shared/studio-contracts";
import { PublicError } from "../core/errors";
import { liveEntryOrder } from "./d1-live-order";

interface BatchRow { id: string; started_at: number; archived_at: number | null; status: "active" | "archived"; count: number; revision: number }
interface EntryRow {
  id: string; batch_id: string; source_type: "public" | "imported"; feedback_id: string | null;
  nickname: string; content: string; topic: LiveEntry["topic"]; custom_topic: string | null;
  source_created_at: number; import_order: number; added_at: number; filename: string | null; import_row_number: number | null;
  queue_group: number; sort_order: number;
  reply_count?: number;
}
const batchSelect = `SELECT b.*, (SELECT COUNT(*) FROM live_entries e WHERE e.batch_id = b.id AND e.removed_at IS NULL) AS count FROM live_batches b`;
const entrySelect = `SELECT e.*, j.filename FROM live_entries e LEFT JOIN live_import_jobs j ON j.id = e.import_job_id`;
const mapBatch = (r: BatchRow): LiveBatch => ({ id: r.id, startedAt: r.started_at, archivedAt: r.archived_at, status: r.status, count: r.count, revision: r.revision });
export class D1LiveRepository {
  constructor(readonly db: D1Database) {}

  async batches(): Promise<LiveBatch[]> {
    const r = await this.db.prepare(`${batchSelect} ORDER BY b.started_at DESC, b.id DESC`).all<BatchRow>();
    return r.results.map(mapBatch);
  }
  async batch(id?: string): Promise<LiveBatch> {
    const r = await this.db.prepare(`${batchSelect} WHERE ${id ? "b.id = ?" : "b.status = 'active'"}`)
      .bind(...(id ? [id] : [])).first<BatchRow>();
    if (!r) throw new PublicError(404, "NOT_FOUND", "直播批次不存在");
    return mapBatch(r);
  }
  async requireActive(id: string): Promise<LiveBatch> {
    const batch = await this.batch(id);
    if (batch.status !== "active") throw new PublicError(409, "REQUEST_CONFLICT", "直播批次已刷新，请重新打开当前批次");
    return batch;
  }
  async list(id: string | undefined, page: number, includeReplyStatus = false): Promise<LiveListSuccess> {
    const batch = await this.batch(id);
    const select = includeReplyStatus ? entrySelect.replace("SELECT e.*", "SELECT (SELECT COUNT(*) FROM feedback_replies r WHERE r.feedback_id = e.feedback_id) AS reply_count, e.*") : entrySelect;
    const rows = await this.db.prepare(`${select} WHERE e.batch_id = ? AND e.removed_at IS NULL
      ORDER BY ${liveEntryOrder("e.")} LIMIT ? OFFSET ?`)
      .bind(batch.id, STUDIO_PAGE_SIZE, (page - 1) * STUDIO_PAGE_SIZE).all<EntryRow>();
    return { ok: true, batch, items: await Promise.all(rows.results.map(r => this.mapEntry(r))),
      page, total: batch.count, totalPages: Math.ceil(batch.count / STUDIO_PAGE_SIZE) };
  }
  async entry(id: string, batchId: string): Promise<LiveEntry> {
    const r = await this.db.prepare(`${entrySelect} WHERE e.id = ? AND e.batch_id = ? AND e.removed_at IS NULL`)
      .bind(id, batchId).first<EntryRow>();
    if (!r) throw new PublicError(404, "NOT_FOUND", "这条留言不在所选直播批次中");
    return this.mapEntry(r);
  }
  private async mapEntry(r: EntryRow): Promise<LiveEntry> {
    const records = r.feedback_id ? await this.db.prepare("SELECT id, byte_size, width, height FROM feedback_images WHERE feedback_id = ? ORDER BY created_at, id")
      .bind(r.feedback_id).all<{ id: string; byte_size: number; width: number; height: number }>() : null;
    const images = records?.results.map(image => ({ id: image.id, mediaType: "image/webp" as const, byteSize: image.byte_size, width: image.width, height: image.height,
      viewUrl: `/api/studio/feedbacks/${r.feedback_id}/images/${image.id}`, downloadUrl: `/api/studio/feedbacks/${r.feedback_id}/images/${image.id}?download=1` })) ?? [];
    return {
      id: r.id, batchId: r.batch_id, sourceType: r.source_type, feedbackId: r.feedback_id,
      feedbackNumber: r.id.slice(0, 8).toUpperCase(), userId: null, nickname: r.nickname,
      content: r.content, contentPreview: r.content.slice(0, 240), topic: r.topic, customTopic: r.custom_topic,
      createdAt: r.source_created_at, importOrder: r.import_order, addedAt: r.added_at,
      queueGroup: r.queue_group, sortOrder: r.sort_order,
      filename: r.filename, importRowNumber: r.import_row_number, imageCount: images.length,
      images, replies: [], replyCount: Number(r.reply_count ?? 0), latestReplyAdmin: null,
      status: r.reply_count ? "replied" : "unreplied", isTodo: false, maskedPhone: null, shopPhone: null,
      moderationStatus: "kept", moderationCategory: null, moderationReason: null, liveSelected: true,
    };
  }
  async sequence(batchId: string, currentId?: string, direction: "previous" | "next" = "next"): Promise<string | null> {
    await this.requireActive(batchId);
    const current = currentId ? await this.entry(currentId, batchId) : null;
    const operator = direction === "next" ? ">" : "<";
    const order = direction === "next" ? "ASC" : "DESC";
    const row = await this.db.prepare(`SELECT id FROM live_entries WHERE batch_id = ? AND removed_at IS NULL
      AND EXISTS (SELECT 1 FROM live_batches WHERE id = batch_id AND status = 'active')
      ${current ? `AND (sort_order, queue_group, source_created_at, import_order, id) ${operator} (?, ?, ?, ?, ?)` : ""}
      ORDER BY ${liveEntryOrder("", order)} LIMIT 1`)
      .bind(batchId, ...(current ? [current.sortOrder, current.queueGroup, current.createdAt, current.importOrder, current.id] : [])).first<{ id: string }>();
    return row?.id ?? null;
  }
  async beginPlayback(now: number): Promise<void> {
    await this.db.prepare("UPDATE live_batches SET playback_started_at = ? WHERE status = 'active' AND playback_started_at IS NULL").bind(now).run();
  }
  async activeMembership(feedbackId: string): Promise<boolean> {
    return Boolean(await this.db.prepare(`SELECT 1 FROM live_entries e JOIN live_batches b ON b.id = e.batch_id
      WHERE e.feedback_id = ? AND e.removed_at IS NULL AND b.status = 'active'`).bind(feedbackId).first());
  }
  async route(input: { feedbackId: string; batchId: string; requestKey: string; routingStatus: "selected" | "not_selected"; adminId: string; now: number }): Promise<void> {
    const action = input.routingStatus === "selected" ? "routing_selected" : "routing_not_selected";
    if (await this.replayed(input.adminId, input.requestKey, action, input.feedbackId, input.batchId)) return;
    await this.requireActive(input.batchId);
    const entryId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const bind = (sql: string, ...args: unknown[]) => this.db.prepare(sql).bind(...args);
    await this.db.batch([
      bind(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, feedback_id, target_id, created_at)
        SELECT ?, ?, ?, ?, ?, f.id, f.id, ? FROM feedback f
        WHERE f.id = ? AND f.moderation_status = 'kept'
          AND EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND status = 'active')
        ON CONFLICT(admin_id, request_key) DO NOTHING`, auditId, input.requestKey, input.adminId, action, input.batchId, input.now, input.feedbackId, input.batchId),
      bind(`UPDATE feedback SET routing_status = ?, updated_at = ? WHERE id = ?
        AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`, input.routingStatus, input.now, input.feedbackId, auditId),
      ...(input.routingStatus === "selected" ? [bind(`INSERT INTO live_entries
        (id, batch_id, source_type, feedback_id, nickname, content, topic, custom_topic, source_created_at, added_at, added_by)
        SELECT ?, ?, 'public', id, douyin_nickname, content, topic, custom_topic, created_at, ?, ? FROM feedback
        WHERE id = ? AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)
        ON CONFLICT(batch_id, feedback_id) DO UPDATE SET removed_at = NULL, removed_by = NULL`,
        entryId, input.batchId, input.now, input.adminId, input.feedbackId, auditId)] : [
        bind(`UPDATE live_entries SET removed_at = ?, removed_by = ? WHERE batch_id = ? AND feedback_id = ? AND removed_at IS NULL
          AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`, input.now, input.adminId, input.batchId, input.feedbackId, auditId),
      ]),
    ]);
    if (!await this.replayed(input.adminId, input.requestKey, action, input.feedbackId, input.batchId)) {
      throw new PublicError(409, "REQUEST_CONFLICT", "留言尚未通过审核或批次已刷新，请刷新后重试");
    }
  }
  async rotate(input: { batchId: string; requestKey: string; adminId: string; now: number }): Promise<LiveBatch> {
    const nextId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    // Conditional archive + successor + audit are one D1 batch transaction. The expected
    // batch identity is a CAS guard even when two clients use different request keys.
    await this.replayed(input.adminId, input.requestKey, "batch_rotated", input.batchId, input.batchId);
    await this.db.batch([
      this.db.prepare(`UPDATE live_batches SET status = 'archived', archived_at = ?, archived_by = ?, successor_id = ?
        WHERE id = ? AND status = 'active' AND NOT EXISTS (SELECT 1 FROM live_audit_logs WHERE admin_id = ? AND request_key = ?)`)
        .bind(input.now, input.adminId, nextId, input.batchId, input.adminId, input.requestKey),
      this.db.prepare(`INSERT INTO live_batches(id, started_at, status, playback_started_at) SELECT ?, ?, 'active',
        CASE WHEN EXISTS (SELECT 1 FROM admin_sessions WHERE mode = 'live' AND expires_at > ?) THEN ? ELSE NULL END
        WHERE EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND successor_id = ?)`)
        .bind(nextId, input.now, input.now, input.now, input.batchId, nextId),
      this.db.prepare(`UPDATE live_import_rows SET status = 'failed', error_code = 'batch_archived', attempt_token = NULL, lease_until = 0
        WHERE status IN ('pending', 'processing') AND job_id IN (SELECT id FROM live_import_jobs WHERE batch_id = ?)
        AND EXISTS (SELECT 1 FROM live_batches WHERE id = ? AND successor_id = ?)`)
        .bind(input.batchId, input.batchId, nextId),
      this.db.prepare(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, target_id, created_at)
        SELECT ?, ?, ?, 'batch_rotated', ?, ?, ? WHERE EXISTS (SELECT 1 FROM live_batches WHERE id = ?)
        ON CONFLICT(admin_id, request_key) DO NOTHING`)
        .bind(auditId, input.requestKey, input.adminId, input.batchId, input.batchId, input.now, nextId),
    ]);
    await this.replayed(input.adminId, input.requestKey, "batch_rotated", input.batchId, input.batchId);
    const old = await this.db.prepare("SELECT successor_id FROM live_batches WHERE id = ?").bind(input.batchId).first<{ successor_id: string | null }>();
    if (!old?.successor_id) throw new PublicError(404, "NOT_FOUND", "直播批次不存在");
    return this.batch(old.successor_id);
  }
  async remove(input: { entryId: string; batchId: string; requestKey: string; adminId: string; now: number }): Promise<void> {
    if (await this.replayed(input.adminId, input.requestKey, "live_removed", input.entryId, input.batchId)) return;
    await this.requireActive(input.batchId);
    const auditId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`INSERT INTO live_audit_logs(id, request_key, admin_id, action, batch_id, feedback_id, target_id, created_at)
        SELECT ?, ?, ?, 'live_removed', e.batch_id, e.feedback_id, e.id, ? FROM live_entries e JOIN live_batches b ON b.id = e.batch_id
        WHERE e.id = ? AND e.batch_id = ? AND e.removed_at IS NULL AND b.status = 'active'
        ON CONFLICT(admin_id, request_key) DO NOTHING`).bind(auditId, input.requestKey, input.adminId, input.now, input.entryId, input.batchId),
      this.db.prepare(`UPDATE live_entries SET removed_at = ?, removed_by = ? WHERE id = ? AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`)
        .bind(input.now, input.adminId, input.entryId, auditId),
      this.db.prepare(`UPDATE feedback SET routing_status = 'pending', is_todo = 0, updated_at = ? WHERE id IN
        (SELECT feedback_id FROM live_entries WHERE id = ?) AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`)
        .bind(input.now, input.entryId, auditId),
      this.db.prepare(`UPDATE live_import_rows SET routing_status = 'pending' WHERE (job_id, row_number) IN
        (SELECT import_job_id, import_row_number FROM live_entries WHERE id = ?)
        AND EXISTS (SELECT 1 FROM live_audit_logs WHERE id = ?)`)
        .bind(input.entryId, auditId),
    ]);
    if (!await this.replayed(input.adminId, input.requestKey, "live_removed", input.entryId, input.batchId)) {
      throw new PublicError(409, "REQUEST_CONFLICT", "留言资格或批次已变化，请刷新列表");
    }
  }
  async replayed(adminId: string, key: string, action: string, target: string, batchId: string): Promise<boolean> {
    const old = await this.db.prepare("SELECT action, target_id, batch_id FROM live_audit_logs WHERE admin_id = ? AND request_key = ?")
      .bind(adminId, key).first<{ action: string; target_id: string; batch_id: string }>();
    if (old && (old.action !== action || old.target_id !== target || old.batch_id !== batchId)) {
      throw new PublicError(409, "REQUEST_CONFLICT", "请求标识已使用，请重新操作");
    }
    return Boolean(old);
  }
}
