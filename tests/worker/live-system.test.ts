import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1LiveRepository } from "../../worker/infra/d1-live-repository";
import { moveLiveEntry } from "../../worker/infra/d1-live-order";
import { D1StudioRepository } from "../../worker/infra/d1-studio-repositories";
import { D1FeedbackRepository } from "../../worker/infra/d1-repositories";
import { LiveImportService } from "../../worker/services/live-import-service";
import { sha256 } from "../../worker/security/crypto";
import type { LiveImportInput } from "../../src/shared/live-contracts";
import { parseLiveWorkbook } from "../../src/shared/live-workbook";

const db = env.BOSS_MESSAGE_DB;
const live = new D1LiveRepository(db);
const studio = new D1StudioRepository(db);
const adminId = "admin-zd";
const initialBatch = "00000000-0000-4000-8000-000000000007";
const publicRepo = new D1FeedbackRepository(db);
async function seed(status = "kept", time = 1) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO feedback(id, submission_key, douyin_nickname, topic, content, moderation_status,
    privacy_policy_version, privacy_agreed_at, livestream_policy_version, livestream_agreed_at, created_at, updated_at)
    VALUES (?, ?, '原始昵称', 'appeal', '原始留言', ?, 'v1', 1, 'v1', 1, ?, ?)`)
    .bind(id, crypto.randomUUID(), status, time, time).run();
  return id;
}
const list = (view: "routing" | "unreplied" | "filtered" | "moderation") => studio.listFeedbacks({ view, topic: null, page: 1, snapshot: null });
const route = (feedbackId: string, routingStatus: "selected" | "not_selected", batchId = initialBatch, requestKey = crypto.randomUUID()) =>
  live.route({ feedbackId, routingStatus, batchId, requestKey, adminId, now: 100 });
const importInput = (count = 3): LiveImportInput => ({ jobId: crypto.randomUUID(), batchId: initialBatch, fileHash: "a".repeat(64), filename: "导入.xlsx", fileSize: 100,
  rows: Array.from({ length: count }, (_, i) => ({ rowNumber: i + 2, nickname: `昵称${i}`, content: `原文${i}` })) });

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM live_audit_logs"), db.prepare("DELETE FROM live_entries"), db.prepare("DELETE FROM live_import_rows"),
    db.prepare("DELETE FROM live_import_jobs"), db.prepare("DELETE FROM live_batches"),
    db.prepare("DELETE FROM audit_logs"), db.prepare("DELETE FROM feedback_replies"), db.prepare("DELETE FROM feedback_images"), db.prepare("DELETE FROM feedback"),
    db.prepare("DELETE FROM admin_sessions"), db.prepare("UPDATE admins SET must_change_password = 0"),
    db.prepare("INSERT INTO live_batches(id, started_at, status) VALUES (?, 1, 'active')").bind(initialBatch),
  ]);
});

describe("separate moderation, routing, replies and live membership", () => {
  it("removes by feedback id idempotently, preserving content/replies and never changing a successor batch", async () => {
    const id = await seed(); await route(id, "selected");
    await studio.appendReply({ id: crypto.randomUUID(), feedbackId: id, replyType: "message", content: "保留回复", admin: { id: adminId, username: "zd" }, now: 150 });
    await db.prepare("UPDATE feedback SET is_todo = 1 WHERE id = ?").bind(id).run();
    const input = { feedbackId: id, batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 200 };
    await live.removeFeedback(input); await live.removeFeedback(input);
    expect(await studio.getFeedbackSummary(id)).toMatchObject({ liveSelected: false, routingStatus: "pending", isTodo: false, replyCount: 1 });
    expect(await db.prepare("SELECT content, moderation_status FROM feedback WHERE id = ?").bind(id).first()).toEqual({ content: "原始留言", moderation_status: "kept" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM live_audit_logs WHERE request_key = ?").bind(input.requestKey).first()).toEqual({ count: 1 });
    const next = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 300 });
    await route(id, "selected", next.id);
    await live.removeFeedback(input);
    expect(await live.activeMembership(id)).toBe(true);
    await expect(live.removeFeedback({ ...input, requestKey: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(live.removeFeedback({ ...input, feedbackId: await seed(), batchId: next.id })).rejects.toMatchObject({ status: 409 });
  });
  it("returns real reply counts only for the management list, including after deletion", async () => {
    const id = await seed(); await route(id, "selected");
    expect((await live.list(initialBatch, 1, true)).items[0]).toMatchObject({ replyCount: 0, status: "unreplied" });
    const replies = [crypto.randomUUID(), crypto.randomUUID()];
    for (const replyId of replies) await studio.appendReply({ id: replyId, feedbackId: id, replyType: "message", content: "后台回复", admin: { id: adminId, username: "zd" }, now: 200 });
    const entry = (await live.list(initialBatch, 1, true)).items[0]!;
    expect(entry).toMatchObject({ replyCount: 2, status: "replied", replies: [], latestReplyAdmin: null });
    expect(await live.entry(entry.id, initialBatch)).toMatchObject({ replyCount: 0, replies: [], status: "unreplied" });
    expect((await live.list(initialBatch, 1)).items[0]?.replyCount).toBe(0);
    await studio.deleteReply({ feedbackId: id, replyId: replies[0]!, adminId, now: 300 });
    expect((await live.list(initialBatch, 1, true)).items[0]?.replyCount).toBe(1);
    await studio.deleteReply({ feedbackId: id, replyId: replies[1]!, adminId, now: 400 });
    expect((await live.list(initialBatch, 1, true)).items[0]).toMatchObject({ replyCount: 0, status: "unreplied" });
    expect(await live.activeMembership(id)).toBe(true);
  });
  it("keeps approved submissions in routing until a human selects or declines", async () => {
    const selected = await seed(); const declined = await seed();
    expect((await list("routing")).items).toHaveLength(2);
    expect((await list("unreplied")).items).toHaveLength(0);
    expect(await live.sequence(initialBatch)).toBeNull();
    await route(selected, "selected"); await route(declined, "not_selected");
    expect((await list("routing")).items).toHaveLength(0);
    expect((await list("unreplied")).items).toHaveLength(2);
    const entries = await live.list(initialBatch, 1);
    expect(entries.items.map(e => e.feedbackId)).toEqual([selected]);
    expect(await studio.getFeedbackSummary(selected)).toMatchObject({ routingStatus: "selected", liveSelected: true });
    expect(await studio.getFeedbackSummary(declined)).toMatchObject({ routingStatus: "not_selected", liveSelected: false });
  });
  it("retains live membership after replying, but replyType live never creates membership", async () => {
    const selected = await seed(); const ordinary = await seed();
    await route(selected, "selected");
    for (const id of [selected, ordinary]) await studio.appendReply({ id: crypto.randomUUID(), feedbackId: id, replyType: "live", content: "回复", admin: { id: adminId, username: "zd" }, now: 200 });
    expect((await list("unreplied")).items).toHaveLength(0);
    expect((await live.list(initialBatch, 1)).items.map(e => e.feedbackId)).toEqual([selected]);
    expect((await studio.listFeedbacks({ view: "live", topic: null, page: 1, snapshot: null })).items).toHaveLength(2);
  });
  it("returns a cancelled public entry to routing and removes it from live, unreplied and todo", async () => {
    const id = await seed();
    await route(id, "selected");
    await studio.setTodo({ feedbackId: id, isTodo: true, adminId, now: 150 });
    const entry = (await live.list(initialBatch, 1)).items[0]!;

    await live.remove({ entryId: entry.id, batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 200 });

    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    expect((await list("unreplied")).items).toHaveLength(0);
    expect((await studio.listFeedbacks({ view: "todo", topic: null, page: 1, snapshot: null })).items).toHaveLength(0);
    expect((await list("routing")).items.map(item => item.id)).toEqual([id]);
    expect(await studio.getFeedbackSummary(id)).toMatchObject({ routingStatus: "pending", liveSelected: false, isTodo: false });

    await route(id, "selected");
    expect((await live.list(initialBatch, 1)).items.map(item => item.feedbackId)).toEqual([id]);
    expect((await list("unreplied")).items.map(item => item.id)).toEqual([id]);
  });
  it.each(["pending", "filtered", "failed"])("excludes %s from routing, unreplied and live; public sees only unreplied", async status => {
    const id = await seed(status);
    await expect(route(id, "selected")).rejects.toMatchObject({ status: 409 });
    expect((await list("routing")).items).toHaveLength(0);
    expect((await list("unreplied")).items).toHaveLength(0);
    expect(await live.sequence(initialBatch)).toBeNull();
    const history = (await publicRepo.findHistory("原始昵称"))!;
    expect(history[0]?.status).toBe("unreplied");
    expect(JSON.stringify(history)).not.toMatch(/moderation|routing|filtered|failed|pending/);
    await studio.setModeration({ feedbackId: id, filtered: false, adminId, now: 300 });
    expect((await list("routing")).items.map(i => i.id)).toEqual([id]);
  });
  it("deduplicates racing routing requests and refuses request-key reuse", async () => {
    const id = await seed(); const key = crypto.randomUUID();
    await Promise.all([route(id, "selected", initialBatch, key), route(id, "selected", initialBatch, key), route(id, "selected")]);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(1);
    await expect(route(id, "not_selected", initialBatch, key)).rejects.toMatchObject({ status: 409 });
    await route(id, "not_selected");
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM live_entries").first()).toEqual({ n: 1 });
  });
  it("uses ascending source time and stable IDs and never imports ordinary messages into the sequence", async () => {
    const ids = [await seed("kept", 20), await seed("kept", 10), await seed("kept", 20)];
    await seed("kept", 0);
    for (const id of ids) await route(id, "selected");
    const entries = (await live.list(initialBatch, 1)).items;
    expect(entries.map(e => e.createdAt)).toEqual([10, 20, 20]);
    expect(entries[1]!.id < entries[2]!.id).toBe(true);
    expect(await live.sequence(initialBatch)).toBe(entries[0]!.id);
    expect(await live.sequence(initialBatch, entries[0]!.id, "previous")).toBeNull();
    expect(await live.sequence(initialBatch, entries[0]!.id)).toBe(entries[1]!.id);
    expect(await live.sequence(initialBatch, entries[2]!.id, "previous")).toBe(entries[1]!.id);
  });
  it("archives atomically, preserves all records, and CAS-deduplicates simultaneous refreshes", async () => {
    await route(await seed(), "selected");
    const input = { batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 1000 };
    const [first, retry, concurrent] = await Promise.all([live.rotate(input), live.rotate(input), live.rotate({ ...input, requestKey: crypto.randomUUID() })]);
    expect(first.id).toBe(retry.id); expect(first.id).toBe(concurrent.id);
    expect((await live.list(first.id, 1)).items).toHaveLength(0);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(1);
    expect(await live.batch(initialBatch)).toMatchObject({ status: "archived", archivedAt: 1000 });
    expect((await live.batches()).filter(b => b.status === "active")).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM feedback").first()).toEqual({ n: 1 });
    await expect(live.sequence(initialBatch)).rejects.toMatchObject({ status: 409 });
    await expect(db.prepare("INSERT INTO live_batches(id, started_at, status) VALUES ('illegal', 1, 'active')").run()).rejects.toThrow();
  });
  it("appends newly selected older submissions after playback begins, without changing original timestamps", async () => {
    const first = await seed("kept", 200); const old = await seed("kept", 1); const newer = await seed("kept", 300);
    await route(first, "selected"); await route(newer, "selected");
    await live.beginPlayback(1000);
    await route(old, "selected");
    const entries = (await live.list(initialBatch, 1)).items;
    expect(entries.map(e => e.feedbackId)).toEqual([first, newer, old]);
    expect(entries[2]?.createdAt).toBe(1);
    expect(await live.sequence(initialBatch, entries[1]!.id)).toBe(entries[2]!.id);
    await route(old, "not_selected"); await route(first, "not_selected"); await route(first, "selected");
    expect((await live.list(initialBatch, 1)).items.map(e => e.feedbackId)).toEqual([newer, first]);
  });
  it("manual filtering revokes current membership without deleting the snapshot", async () => {
    const id = await seed(); await route(id, "selected");
    await studio.setModeration({ feedbackId: id, filtered: true, adminId, now: 200 });
    expect(await live.activeMembership(id)).toBe(false);
    expect(await live.sequence(initialBatch)).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM live_entries").first()).toEqual({ n: 1 });
    await studio.setModeration({ feedbackId: id, filtered: false, adminId, now: 300 });
    expect((await list("routing")).items).toHaveLength(1);
  });
  it("keeps successor batches append-only while an existing live session remains open", async () => {
    await db.prepare("INSERT INTO admin_sessions(token_hash, admin_id, mode, created_at, expires_at) VALUES ('fixture', ?, 'live', 1, 9000)").bind(adminId).run();
    const next = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 1000 });
    const newer = await seed("kept", 200); const older = await seed("kept", 1);
    await route(newer, "selected", next.id); await route(older, "selected", next.id);
    expect((await live.list(next.id, 1)).items.map(e => e.feedbackId)).toEqual([newer, older]);
  });
});

describe("administrator-defined live order", () => {
  async function entries(count = 3) {
    for (let i = 0; i < count; i++) await route(await seed("kept", i + 10), "selected");
    return (await live.list(initialBatch, 1)).items;
  }
  async function input(entryId: string, position: number) {
    return { entryId, position, batchId: initialBatch, expectedRevision: (await live.batch()).revision,
      requestKey: crypto.randomUUID(), adminId, now: 200 };
  }
  const ids = async (page = 1) => (await live.list(initialBatch, page)).items.map(e => e.id);

  it("moves in both directions and uses the same persisted order for forward/backward playback", async () => {
    const [a, b, c] = await entries();
    await moveLiveEntry(db, await input(c!.id, 1));
    expect(await ids()).toEqual([c!.id, a!.id, b!.id]);
    expect(await live.sequence(initialBatch)).toBe(c!.id);
    expect(await live.sequence(initialBatch, c!.id)).toBe(a!.id);
    expect(await live.sequence(initialBatch, a!.id, "previous")).toBe(c!.id);
    expect(await live.sequence(initialBatch, b!.id)).toBeNull();
    await live.beginPlayback(300);
    await moveLiveEntry(db, await input(c!.id, 3));
    expect(await ids()).toEqual([a!.id, b!.id, c!.id]);
    expect((await live.entry(c!.id, initialBatch)).createdAt).toBe(c!.createdAt);
    expect((await live.entry(c!.id, initialBatch)).content).toBe(c!.content);
    expect(await live.sequence(initialBatch, b!.id)).toBe(c!.id);
  });
  it("moves across pagination boundaries without losing or duplicating entries", async () => {
    const firstPage = await entries(31);
    const last = (await live.list(initialBatch, 2)).items[0]!;
    await moveLiveEntry(db, await input(last.id, 1));
    expect((await ids())[0]).toBe(last.id);
    expect(await ids(2)).toEqual([firstPage[29]!.id]);
    await moveLiveEntry(db, await input(last.id, 31));
    expect(await ids()).toEqual(firstPage.map(e => e.id));
    expect(await ids(2)).toEqual([last.id]);
    expect((await live.batch()).count).toBe(31);
  });
  it("sorts public and imported entries together and appends new/reselected entries before playback", async () => {
    const [a, b] = await entries(2);
    const service = new LiveImportService(db, async () => ({ topic: "appeal", customTopic: null }));
    const job = importInput(2); await service.create(job, adminId, 1000); await service.run();
    const selectRow = (rowNumber: number) => service.route({ jobId: job.jobId, rowNumber, batchId: initialBatch,
      requestKey: crypto.randomUUID(), routingStatus: "selected", adminId, now: 2000 });
    await selectRow(2);
    const imported = (await live.list(initialBatch, 1)).items[2]!;
    await moveLiveEntry(db, await input(imported.id, 1));
    const early = await seed("kept", 0); await route(early, "selected");
    await selectRow(3);
    expect((await live.list(initialBatch, 1)).items.map(e => e.feedbackId)).toEqual([null, a!.feedbackId, b!.feedbackId, early, null]);
    await live.remove({ entryId: imported.id, batchId: initialBatch, adminId, requestKey: crypto.randomUUID(), now: 3000 });
    await selectRow(2);
    expect((await ids()).at(-1)).toBe(imported.id);
    await route(a!.feedbackId!, "not_selected"); await route(a!.feedbackId!, "selected");
    expect((await ids()).at(-1)).toBe(a!.id);
  });
  it("deduplicates retries, rejects changed payloads and rejects stale revisions without writing", async () => {
    const [a, , c] = await entries();
    const request = await input(c!.id, 1);
    await Promise.all([moveLiveEntry(db, request), moveLiveEntry(db, request)]);
    expect((await live.batch()).revision).toBe(request.expectedRevision + 1);
    expect((await ids())[0]).toBe(c!.id);
    await expect(moveLiveEntry(db, { ...request, position: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(moveLiveEntry(db, { ...request, entryId: a!.id, requestKey: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM live_order_requests").first()).toEqual({ n: 1 });
  });
  it("allows exactly one of two administrators' concurrent moves against the same revision", async () => {
    const [a, b, c] = await entries();
    const first = await input(c!.id, 1);
    const second = { ...await input(a!.id, 3), adminId: "admin-order-test" };
    await db.prepare("INSERT INTO admins(id, username, password_hash, created_at, updated_at) SELECT ?, ?, password_hash, 1, 1 FROM admins WHERE id = ?")
      .bind(second.adminId, second.adminId, adminId).run();
    const results = await Promise.allSettled([moveLiveEntry(db, first), moveLiveEntry(db, second)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect([ [c!.id, a!.id, b!.id], [b!.id, c!.id, a!.id] ]).toContainEqual(await ids());
    expect((await live.batch()).revision).toBe(first.expectedRevision + 1);
  });
  it("rejects removed/foreign entries, out-of-range positions and changes after membership updates", async () => {
    const [a, b] = await entries(2);
    const request = await input(a!.id, 2);
    await route(await seed(), "selected");
    await expect(moveLiveEntry(db, request)).rejects.toMatchObject({ status: 409 });
    await live.remove({ entryId: b!.id, batchId: initialBatch, adminId, requestKey: crypto.randomUUID(), now: 300 });
    for (const invalid of [await input(b!.id, 1), await input(crypto.randomUUID(), 1), await input(a!.id, 999)]) {
      await expect(moveLiveEntry(db, invalid)).rejects.toMatchObject({ status: 409 });
    }
    expect(await db.prepare("SELECT COUNT(*) AS n FROM live_order_requests").first()).toEqual({ n: 0 });
  });
  it("preserves archived custom order and starts the successor with default ordering", async () => {
    const [a, b, c] = await entries();
    await moveLiveEntry(db, await input(c!.id, 1));
    const request = await input(a!.id, 1);
    const next = await live.rotate({ batchId: initialBatch, adminId, requestKey: crypto.randomUUID(), now: 500 });
    await expect(moveLiveEntry(db, request)).rejects.toMatchObject({ status: 409 });
    expect(await ids()).toEqual([c!.id, a!.id, b!.id]);
    const newer = await seed("kept", 30); const older = await seed("kept", 0);
    await route(newer, "selected", next.id); await route(older, "selected", next.id);
    expect((await live.list(next.id, 1)).items.map(e => e.feedbackId)).toEqual([older, newer]);
  });
  it("rolls back the audit and revision if the order update fails", async () => {
    const list = await entries(); const request = await input(list[2]!.id, 1);
    await db.prepare("CREATE TRIGGER order_test_failure BEFORE UPDATE OF sort_order ON live_entries BEGIN SELECT RAISE(ABORT, 'order test failure'); END").run();
    try { await expect(moveLiveEntry(db, request)).rejects.toThrow(); }
    finally { await db.prepare("DROP TRIGGER order_test_failure").run(); }
    expect(await ids()).toEqual(list.map(e => e.id));
    expect((await live.batch()).revision).toBe(request.expectedRevision);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM live_order_requests").first()).toEqual({ n: 0 });
  });
});

describe("durable import jobs", () => {
  it("classifies without rewriting, waits for human routing, and isolates public data", async () => {
    const classify = vi.fn(async () => ({ topic: "other" as const, customTopic: "门店体验" }));
    const service = new LiveImportService(db, classify);
    const input = importInput(); await service.create(input, adminId, 9000);
    await service.run();
    const job = await service.job(input.jobId);
    expect(job.rows.every(r => r.status === "imported")).toBe(true);
    expect(job.rows.every(r => r.routingStatus === "pending")).toBe(true);
    expect(classify).toHaveBeenCalledTimes(3);
    const pending = await service.routing(1, null);
    expect(pending.items.map(e => e.content)).toEqual(input.rows.map(r => r.content));
    expect(pending.items.map(e => e.nickname)).toEqual(input.rows.map(r => r.nickname));
    expect(pending.items.map(e => e.rowNumber)).toEqual([2, 3, 4]);
    expect(pending.items.every(e => e.createdAt === 9000 && e.customTopic === "门店体验")).toBe(true);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    const selectedKey = crypto.randomUUID();
    const selectedInput = { jobId: input.jobId, rowNumber: 2, batchId: initialBatch, requestKey: selectedKey, routingStatus: "selected" as const, adminId, now: 9100 };
    await Promise.all([service.route(selectedInput), service.route(selectedInput)]);
    await service.route({ jobId: input.jobId, rowNumber: 3, batchId: initialBatch, requestKey: crypto.randomUUID(), routingStatus: "not_selected", adminId, now: 9200 });
    const entries = (await live.list(initialBatch, 1)).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ content: "原文0", nickname: "昵称0", importOrder: 2, sourceType: "imported", feedbackId: null, customTopic: "门店体验" });
    await expect(service.route({ ...selectedInput, routingStatus: "not_selected" })).rejects.toMatchObject({ status: 409 });
    await live.remove({ entryId: entries[0]!.id, batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 9300 });
    expect((await service.job(input.jobId)).rows[0]?.routingStatus).toBe("pending");
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    expect((await service.routing(1, null)).items.map(row => row.rowNumber)).toEqual([2, 4]);
    await service.route({ ...selectedInput, requestKey: crypto.randomUUID(), now: 9400 });
    expect((await live.list(initialBatch, 1)).items.map(row => row.content)).toEqual(["原文0"]);
    expect((await service.routing(1, null)).items.map(row => row.rowNumber)).toEqual([4]);
    const reselected = (await live.list(initialBatch, 1)).items[0]!;
    await live.remove({ entryId: reselected.id, batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 9500 });
    const next = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 9600 });
    await service.route({ ...selectedInput, batchId: next.id, requestKey: crypto.randomUUID(), now: 9700 });
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    expect((await live.list(next.id, 1)).items.map(row => row.content)).toEqual(["原文0"]);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM live_entries
      WHERE import_job_id = ? AND import_row_number = ?`).bind(input.jobId, 2).first()).toEqual({ n: 2 });
    expect((await list("unreplied")).items).toHaveLength(0);
    expect(await publicRepo.findHistory("昵称0")).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM feedback").first()).toEqual({ n: 0 });
  });
  it("handles partial failure and same-file/job/retry idempotency", async () => {
    let fail = true;
    const service = new LiveImportService(db, async content => {
      if (content === "原文1" && fail) throw new Error("provider failed");
      return { topic: "appeal", customTopic: null };
    });
    const input = importInput();
    const [job1, job2] = await Promise.all([service.create(input, adminId, 1000), service.create(input, adminId, 1000)]);
    expect(job1.id).toBe(job2.id);
    expect((await service.create({ ...input, jobId: crypto.randomUUID() }, adminId, 1000)).id).toBe(job1.id);
    await service.run();
    expect((await service.job(input.jobId)).rows.map(r => r.status)).toEqual(["imported", "failed", "imported"]);
    fail = false;
    const key = crypto.randomUUID();
    await service.retry(input.jobId, key, adminId, [3], 2000);
    await Promise.all([service.run(), service.run()]);
    await service.retry(input.jobId, key, adminId, [3], 2000);
    expect((await service.job(input.jobId)).rows.every(r => r.status === "imported")).toBe(true);
    expect((await service.routing(1, null)).items).toHaveLength(3);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    await expect(service.create({ ...input, rows: [{ ...input.rows[0]!, content: "变更内容" }] }, adminId, 2000)).rejects.toMatchObject({ status: 409 });
  });
  it("limits concurrent provider calls globally across overlapping runners", async () => {
    const releases: Array<() => void> = [];
    let active = 0; let peak = 0;
    const service = new LiveImportService(db, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--; return { topic: "appeal", customTopic: null };
    });
    await service.create(importInput(8), adminId, 1000);
    const running = Promise.all([service.run(), service.run()]);
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.forEach(resolve => resolve()); await running;
    expect(peak).toBe(3);
    expect((await service.routing(1, null)).items).toHaveLength(3);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
  });
  it("does not insert late AI results into an archived or successor batch", async () => {
    let release!: () => void;
    const service = new LiveImportService(db, async () => { await new Promise<void>(resolve => { release = resolve; }); return { topic: "appeal", customTopic: null }; });
    const input = importInput(1); await service.create(input, adminId, 1000);
    const running = service.run(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const next = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 2000 });
    release(); await running;
    expect((await service.job(input.jobId)).rows[0]).toMatchObject({ status: "failed", errorCode: "batch_archived" });
    expect((await live.list(next.id, 1)).items).toHaveLength(0);
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    await expect(service.retry(input.jobId, crypto.randomUUID(), adminId, [2], 3000)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps already classified rows pending across rotation and routes them only into the current batch", async () => {
    const service = new LiveImportService(db, async () => ({ topic: "appeal", customTopic: null }));
    const input = importInput(1); await service.create(input, adminId, 1000); await service.run();
    const next = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 2000 });
    expect((await service.routing(1, null)).items.map(row => row.rowNumber)).toEqual([2]);
    await service.route({ jobId: input.jobId, rowNumber: 2, batchId: next.id, requestKey: crypto.randomUUID(), routingStatus: "selected", adminId, now: 3000 });
    expect((await live.list(initialBatch, 1)).items).toHaveLength(0);
    expect((await live.list(next.id, 1)).items).toMatchObject([{ sourceType: "imported", content: "原文0" }]);
  });
  it("preserves row order after out-of-order classification and appends human selections during playback", async () => {
    const releases = new Map<string, () => void>();
    const service = new LiveImportService(db, async content => {
      await new Promise<void>(resolve => releases.set(content, resolve));
      return { topic: "released_software", customTopic: null };
    });
    await route(await seed("kept", 20), "selected");
    await live.beginPlayback(1000);
    const input = importInput(); await service.create(input, adminId, 2000);
    const laterPublic = await seed("kept", 1); await route(laterPublic, "selected");
    const running = service.run(); await vi.waitFor(() => expect(releases.size).toBe(3));
    releases.get("原文2")!(); releases.get("原文0")!(); releases.get("原文1")!(); await running;
    expect((await service.routing(1, null)).items.map(row => row.content)).toEqual(["原文0", "原文1", "原文2"]);
    for (const rowNumber of [2, 3, 4]) await service.route({
      jobId: input.jobId, rowNumber, batchId: initialBatch, requestKey: crypto.randomUUID(), routingStatus: "selected", adminId, now: 3000 + rowNumber,
    });
    const entries = (await live.list(initialBatch, 1)).items;
    expect(entries.map(e => e.content)).toEqual(["原始留言", "原始留言", "原文0", "原文1", "原文2"]);
    expect(entries[1]?.feedbackId).toBe(laterPublic);
    expect(entries.filter(e => e.sourceType === "imported").map(e => e.importOrder)).toEqual([2, 3, 4]);
  });
});

describe("live API permission boundary", () => {
  it("enforces authentication, same origin, no-store, normal-only writes and historical reads", async () => {
    const token = "a".repeat(43);
    const tokenHash = await sha256(new TextEncoder().encode(token).buffer as ArrayBuffer);
    await db.prepare("INSERT INTO admin_sessions(token_hash, admin_id, mode, created_at, expires_at) VALUES (?, ?, 'normal', 1, ?)")
      .bind(tokenHash, adminId, Date.now() + 60_000).run();
    const origin = "https://message.example";
    const headers = { Cookie: `__Host-boss_studio_session=${token}`, Origin: origin, "Content-Type": "application/json" };
    const request = (path: string, method = "GET", body?: unknown, h = headers) => SELF.fetch(`${origin}/api/studio${path}`, { method, headers: h, ...(body ? { body: JSON.stringify(body) } : {}) });
    const id = await seed();
    const input = { batchId: initialBatch, requestKey: crypto.randomUUID(), routingStatus: "selected" };
    expect((await SELF.fetch(`${origin}/api/studio/live/active`)).status).toBe(401);
    expect((await request(`/live/routing/${id}`, "POST", input, { ...headers, Origin: "https://evil.example" })).status).toBe(403);
    expect((await request(`/live/routing/${id}`, "POST", { ...input, routingStatus: "invalid" })).status).toBe(400);
    expect((await request(`/live/routing/${id}`, "POST", input)).status).toBe(200);
    const removePath = `/live/routing/${id}/remove`;
    const removeInput = { batchId: initialBatch, requestKey: crypto.randomUUID() };
    expect((await SELF.fetch(`${origin}/api/studio${removePath}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(removeInput) })).status).toBe(401);
    expect((await request(removePath, "POST", removeInput, { ...headers, Origin: "https://evil.example" })).status).toBe(403);
    expect((await request(removePath, "POST", { ...removeInput, adminId: "forged-admin" })).status).toBe(400);
    const removed = await request(removePath, "POST", removeInput);
    expect(removed.status).toBe(200); expect(removed.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await request(removePath, "POST", removeInput)).status).toBe(200);
    expect(await live.activeMembership(id)).toBe(false);
    expect((await request(`/live/routing/${id}`, "POST", { ...input, requestKey: crypto.randomUUID() })).status).toBe(200);
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("留言");
    sheet.addRow(["用户名", "用户留言", "无关列"]); sheet.addRow(["导入者", "导入正文", "不保存"]);
    const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "api.xlsx");
    const preview = await parseLiveWorkbook(file);
    const upload = new FormData(); upload.set("file", file);
    const jobId = crypto.randomUUID();
    upload.set("payload", JSON.stringify({ jobId, batchId: initialBatch, fileHash: preview.fileHash }));
    const uploaded = await SELF.fetch(`${origin}/api/studio/live/imports`, { method: "POST", headers: { Cookie: headers.Cookie, Origin: origin }, body: upload });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ job: { id: jobId, filename: "api.xlsx", rows: [{ nickname: "导入者", content: "导入正文" }] } });
    await vi.waitFor(async () => expect(await db.prepare("SELECT status FROM live_import_rows WHERE job_id = ?").bind(jobId).first()).toEqual({ status: "failed" }));
    const importService = new LiveImportService(db, async () => ({ topic: "appeal", customTopic: null }));
    await importService.retry(jobId, crypto.randomUUID(), adminId, [2], Date.now());
    await importService.run();
    const pendingImport = await request("/live/imports/routing");
    expect(pendingImport.status).toBe(200);
    expect(await pendingImport.json()).toMatchObject({ total: 1, items: [{ jobId, rowNumber: 2, nickname: "导入者", routingStatus: "pending" }] });
    const importRouteInput = { batchId: initialBatch, requestKey: crypto.randomUUID(), routingStatus: "selected" };
    expect((await request(`/live/imports/${jobId}/rows/2/routing`, "POST", importRouteInput)).status).toBe(200);
    expect(await (await request("/live/imports/routing")).json()).toMatchObject({ total: 0, items: [] });
    const entry = (await live.list(initialBatch, 1)).items[0]!;
    const moveInput = { batchId: initialBatch, requestKey: crypto.randomUUID(), expectedRevision: (await live.batch()).revision, position: 1 };
    const movePath = `/live/entries/${entry.id}/move`;
    expect((await SELF.fetch(`${origin}/api/studio${movePath}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(moveInput) })).status).toBe(401);
    expect((await request(movePath, "POST", moveInput, { ...headers, Origin: "https://evil.example" })).status).toBe(403);
    for (const position of [0, -1, 1.5, "2"]) expect((await request(movePath, "POST", { ...moveInput, position })).status).toBe(400);
    expect((await request(movePath, "POST", { ...moveInput, adminId: "forged-admin" })).status).toBe(400);
    const moved = await request(movePath, "POST", moveInput);
    expect(moved.status).toBe(200); expect(moved.headers.get("Cache-Control")).toBe("private, no-store");
    await studio.appendReply({ id: crypto.randomUUID(), feedbackId: id, replyType: "message", content: "回复状态测试", admin: { id: adminId, username: "zd" }, now: 1500 });
    expect(await (await request(`/live/entries?batchId=${initialBatch}`)).json()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ feedbackId: id, replyCount: 1, status: "replied" })]) });
    await db.prepare("UPDATE admin_sessions SET mode = 'live'").run();
    expect((await request(removePath, "POST", { ...removeInput, requestKey: crypto.randomUUID() })).status).toBe(403);
    expect(await (await request(`/live/entries?batchId=${initialBatch}`)).json()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ feedbackId: id, replyCount: 0, replies: [] })]) });
    await db.prepare("UPDATE admin_sessions SET mode = 'normal'").run();
    const archived = await live.rotate({ batchId: initialBatch, requestKey: crypto.randomUUID(), adminId, now: 2000 });
    const normalHistory = await request(`/live/entries?batchId=${initialBatch}`);
    expect(normalHistory.status).toBe(200); expect(normalHistory.headers.get("Cache-Control")).toBe("private, no-store");
    await db.prepare("UPDATE admin_sessions SET mode = 'live'").run();
    expect((await request(movePath, "POST", moveInput)).status).toBe(403);
    expect((await request(`/live/entries?batchId=${initialBatch}`)).status).toBe(409);
    expect((await request(`/live/entries/${entry.id}?batchId=${initialBatch}`)).status).toBe(409);
    expect((await request("/live/batches")).status).toBe(403);
    expect((await request("/feedbacks?view=unreplied")).status).toBe(403);
    expect((await request(`/feedbacks/${id}`)).status).toBe(403);
    expect((await request(`/live/routing/${id}`, "POST", input)).status).toBe(403);
    expect((await request(`/live/imports/${jobId}/rows/2/routing`, "POST", importRouteInput)).status).toBe(403);
    expect((await request("/live/rotate", "POST", { batchId: archived.id, requestKey: crypto.randomUUID() })).status).toBe(403);
    expect((await request("/live/imports", "POST", importInput())).status).toBe(403);
    expect((await request(`/live/imports?batchId=${archived.id}`)).status).toBe(403);
    expect((await request(`/live/sequence?batchId=${archived.id}`)).status).toBe(200);
  });
});
