import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes, MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FeedbackDetailPage } from "../../src/features/studio/pages/FeedbackDetailPage";
import { resetLiveSequence } from "../../src/features/studio/live-sequence";

const feedbackId = "22222222-2222-4222-8222-222222222222";
const batchId = "00000000-0000-4000-8000-000000000007";
const detail = {
  ok: true,
  item: {
    id: feedbackId,
    feedbackNumber: "22222222",
    userId: "11111111-1111-4111-8111-111111111111",
    nickname: "测试昵称",
    topic: "appeal",
    customTopic: null,
    contentPreview: "完整留言",
    content: "完整留言",
    imageCount: 0,
    images: [],
    maskedPhone: "1**********",
    shopPhone: "+853 6612-3456",
    createdAt: Date.UTC(2026, 8, 3),
    status: "unreplied",
    isTodo: false,
    replyCount: 0,
    latestReplyAdmin: null,
    replies: [],
    moderationStatus: "kept",
    moderationCategory: "valid_feedback",
    moderationReason: "有效反馈",
  },
};

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

afterEach(() => {
  resetLiveSequence();
  vi.unstubAllGlobals();
});

function renderDetail(liveMode: boolean) {
  vi.stubGlobal("scrollTo", vi.fn());
  return render(
    <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}${liveMode ? `?mode=live&view=live_display&batch=${batchId}` : ""}`]}>
      <Routes>
        <Route element={<Outlet context={{ liveMode }} />}>
          <Route path="/studio/feedback/:feedbackId" element={<FeedbackDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockDetailApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (url.includes("/live/active")) return Response.json({ ok: true, batch: { id: batchId } });
    if (url.includes("/live/sequence?")) return Response.json({ ok: true, nextFeedbackId: null, batchId });
    if (url.includes(`/live/entries/${feedbackId}?`)) return Response.json(detail);
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body)) as { content: string; replyType?: string };
      return new Response(JSON.stringify({
        ok: true,
        reply: {
          id: "33333333-3333-4333-8333-333333333333",
          replyType: body.replyType ?? "live",
          content: body.content,
          adminUsername: "zd",
          createdAt: Date.UTC(2026, 8, 3, 1),
        },
        status: "replied",
        isTodo: false,
        replyCount: 1,
        latestReplyAdmin: "zd",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes(`/api/studio/feedbacks/${feedbackId}/next`)) {
      return new Response(JSON.stringify({ ok: true, nextFeedbackId: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes(`/api/studio/feedbacks/${feedbackId}`)) {
      return new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Studio reply interaction", () => {
  it("selects and cancels live display from the moderation row without losing the reply draft", async () => {
    let selected = false;
    const posts: Array<{ url: string; body: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/live/active")) return Response.json({ ok: true, batch: { id: batchId } });
      if (init?.method === "POST") {
        posts.push({ url: input, body: JSON.parse(String(init.body)) });
        selected = !input.endsWith("/remove");
        return Response.json({ ok: true });
      }
      return Response.json({ ...detail, item: { ...detail.item, liveSelected: selected, routingStatus: selected ? "selected" : "pending" } });
    }));
    const user = userEvent.setup(); renderDetail(false);
    await screen.findByRole("button", { name: "选入直播展示" });
    const draft = screen.getByRole("textbox", { name: "回复内容" });
    await user.type(draft, "未提交的草稿");
    await user.click(screen.getByRole("button", { name: "选入直播展示" }));
    await screen.findByRole("button", { name: "取消直播展示" });
    expect(posts[0]).toMatchObject({ url: `/api/studio/live/routing/${feedbackId}`, body: { batchId, routingStatus: "selected" } });
    await user.click(screen.getByRole("button", { name: "取消直播展示" }));
    await screen.findByRole("button", { name: "选入直播展示" });
    expect(posts[1]).toMatchObject({ url: `/api/studio/live/routing/${feedbackId}/remove`, body: { batchId } });
    expect(posts[0]!.body.requestKey).not.toBe(posts[1]!.body.requestKey);
    expect(draft).toHaveValue("未提交的草稿");
  });

  it("pins retries to the same live batch and key, locks conflicting actions, then only refreshes a saved mutation", async () => {
    const bodies: unknown[] = [];
    let activeReads = 0; let reads = 0; let release!: () => void;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/live/active")) { activeReads++; return Response.json({ ok: true, batch: { id: batchId } }); }
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) {
          await new Promise<void>(resolve => { release = resolve; });
          throw new Error("网络中断");
        }
        return Response.json({ ok: true });
      }
      if (++reads === 2) throw new Error("读取详情失败");
      return Response.json({ ...detail, item: { ...detail.item, liveSelected: reads > 1 } });
    }));
    const user = userEvent.setup(); renderDetail(false);
    await user.click(await screen.findByRole("button", { name: "选入直播展示" }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(screen.getByRole("button", { name: "正在更新直播展示" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "标记为已过滤" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    release();
    await user.click(await screen.findByRole("button", { name: "重试直播展示操作" }));
    await screen.findByText(/读取详情失败/);
    await user.click(screen.getByRole("button", { name: "重试直播展示操作" }));
    await screen.findByRole("button", { name: "取消直播展示" });
    expect(activeReads).toBe(1); expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
    expect(screen.getByRole("button", { name: "标记为已过滤" })).toBeEnabled();
  });

  it("clears live selection when filtering and allows selection only after restoring", async () => {
    let filtered = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        filtered = JSON.parse(String(init.body)).filtered;
        return Response.json({ ok: true, moderationStatus: filtered ? "filtered" : "kept", isTodo: false });
      }
      return Response.json({ ...detail, item: { ...detail.item, liveSelected: true } });
    }));
    const user = userEvent.setup(); renderDetail(false);
    await screen.findByRole("button", { name: "取消直播展示" });
    await user.click(screen.getByRole("button", { name: "标记为已过滤" }));
    expect(await screen.findByRole("button", { name: "选入直播展示" })).toBeDisabled();
    expect(screen.getByText("请先恢复留言")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复留言" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选入直播展示" })).toBeEnabled());
  });

  it("confirms deletion, retains the draft on failure and success, and updates the history", async () => {
    const reply = { id: "reply-delete", content: "需要删除的历史回复", replyType: "message", adminUsername: "fa", createdAt: Date.UTC(2026, 8, 3, 1) };
    let attempts = 0;
    let finishDelete: (() => void) | undefined;
    const changed = vi.fn();
    window.addEventListener("studio:changed", changed);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        attempts++;
        if (attempts === 1) return Response.json({ error: { message: "删除失败，请重试" } }, { status: 500 });
        await new Promise<void>(resolve => { finishDelete = resolve; });
        return Response.json(detail);
      }
      return Response.json({ ...detail, item: { ...detail.item, replies: [reply], status: "replied", replyCount: 1 } });
    }));
    const user = userEvent.setup();
    renderDetail(false);
    const remove = await screen.findByRole("button", { name: "删除第 1 条回复" });
    const draft = screen.getByRole("textbox", { name: "回复内容" });
    await user.type(draft, "尚未提交的新回复");
    await user.click(remove);
    expect(attempts).toBe(0);
    await user.click(screen.getAllByRole("button", { name: "取消" }).at(-1)!);
    expect(attempts).toBe(0);
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败，请重试");
    expect(screen.getByText(reply.content)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(screen.getByRole("button", { name: "正在处理" })).toBeDisabled();
    finishDelete?.();
    expect(await screen.findByText("回复已删除，原始留言保持不变。")).toBeInTheDocument();
    expect(screen.queryByText(reply.content)).not.toBeInTheDocument();
    expect(screen.getByText("还没有回复。")).toBeInTheDocument();
    expect(screen.getByText("完整留言")).toBeInTheDocument();
    expect(draft).toHaveValue("尚未提交的新回复");
    expect(screen.getByText("历史回复")).toHaveFocus();
    expect(attempts).toBe(2);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("studio:changed", changed);
  });

  it("shows the shop phone directly in normal mode without a reveal action", async () => {
    mockDetailApi();
    renderDetail(false);
    expect(await screen.findByText("+853 6612-3456")).toBeInTheDocument();
    expect(screen.getByText("张导小店绑定手机号")).toBeInTheDocument();
  });

  it("requires confirmation for a normal-mode reply", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(false);
    await screen.findByRole("heading", { name: "申冤" });
    await user.click(screen.getByRole("radio", { name: "留言回复" }));
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "普通回复内容");
    await user.click(screen.getByRole("button", { name: "提交" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "确认提交这条回复？" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(await screen.findByRole("status")).toHaveTextContent("回复已提交");
  });

  it("opens the next feedback from the same list and topic after a successful reply", async () => {
    const nextId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/next?")) return Response.json({ ok: true, nextFeedbackId: nextId });
      if (url.endsWith(nextId)) return Response.json({ ...detail, item: { ...detail.item, id: nextId, nickname: "下一条测试昵称" } });
      return original(input, init);
    });
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}?view=unreplied&topic=appeal`]}>
        <Routes><Route element={<Outlet context={{ liveMode: false }} />}>
          <Route path="/studio/feedback/:feedbackId" element={<FeedbackDetailPage />} />
        </Route></Routes>
      </MemoryRouter>,
    );
    await screen.findByText("测试昵称");
    expect(screen.queryByRole("button", { name: "下一条留言" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "留言回复" }));
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "处理完成");
    await user.click(screen.getByRole("button", { name: "提交" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(await screen.findByRole("button", { name: "下一条留言" }));
    await screen.findByText("下一条测试昵称");
    const navigationCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/next?"));
    expect(String(navigationCall?.[0])).toContain("view=unreplied");
    expect(String(navigationCall?.[0])).toContain("topic=appeal");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("shows only identity, message and images in live mode, even when replies exist", async () => {
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes(`/live/entries/${feedbackId}?`)) {
        return Response.json({ ...detail, item: {
          ...detail.item,
          replies: [{ id: "reply", replyType: "live", content: "不应出现在直播画面的历史回复", createdAt: 1000, adminUsername: "zd" }],
          images: [{ id: "image", viewUrl: "/fixture.webp", downloadUrl: "/fixture.webp", width: 800, height: 600 }],
        } });
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });
    expect(screen.queryByText("鹏友")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "测试昵称" }).closest("header")).toHaveClass("studio-live-identity");
    expect(screen.getByText("申冤").closest("header")).toHaveClass("studio-live-identity");
    expect(screen.queryByText("主题", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "留言内容" })).toHaveTextContent("完整留言");
    for (const hidden of ["未回复", "#22222222", "手机号", "1**********", "张导小店绑定手机号", "+853 6612-3456", "提交时间", "历史回复", "不应出现在直播画面的历史回复", "直播回复", "追加回复", "选入直播展示", "取消直播展示"]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上一条" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一条" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放大留言图片 1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/next?"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("announces the end of the live sequence without writing replies", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });
    await user.keyboard("{ArrowRight}");
    // Live mode runs oldest-first, so running out of steps means the newest message was reached.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已经是最新的一条留言了"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一条" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("reports a failed live step and keeps the current message on screen", async () => {
    const fetchMock = mockDetailApi();
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes("/live/sequence?")) throw new TypeError("Failed to fetch");
      return Response.json(detail);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "测试昵称" })).toBeInTheDocument();
  });

  it("switches with left and right arrow keys while retaining the live batch", async () => {
    const nextId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/live/sequence?") && url.includes("direction=next")) return Response.json({ ok: true, nextFeedbackId: nextId });
      if (url.includes("/live/sequence?") && url.includes("direction=previous")) return Response.json({ ok: true, nextFeedbackId: feedbackId });
      if (url.includes(`/live/entries/${nextId}?`)) return Response.json({ ...detail, item: { ...detail.item, id: nextId, nickname: "下一位鹏友" } });
      return original(input, init);
    });
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}?mode=live&view=live_display&batch=${batchId}`]}>
        <Routes><Route element={<Outlet context={{ liveMode: true }} />}>
          <Route path="/studio/feedback/:feedbackId" element={<FeedbackDetailPage />} />
        </Route></Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "测试昵称" });
    await user.keyboard("{ArrowRight}");
    await screen.findByRole("heading", { name: "下一位鹏友" });
    await user.keyboard("{ArrowLeft}");
    await screen.findByRole("heading", { name: "测试昵称" });

    const navigationCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/live/sequence?"));
    expect(navigationCalls.length).toBeGreaterThan(0);
    for (const [input] of navigationCalls) {
      expect(String(input)).toContain(`batchId=${batchId}`);
      expect(String(input)).not.toContain("view=todo");
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("advances one message per key press when the arrow keys are hammered", async () => {
    const second = "44444444-4444-4444-8444-444444444444";
    const third = "55555555-5555-4555-8555-555555555555";
    const chain: Record<string, string | null> = { [feedbackId]: second, [second]: third, [third]: null };
    const fetchMock = mockDetailApi();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/live/sequence?")) {
        const current = new URL(url, "http://localhost").searchParams.get("currentId") ?? "";
        return Response.json({ ok: true, nextFeedbackId: chain[current] ?? null });
      }
      const id = url.match(/entries\/([0-9a-f-]+)\?/)?.[1] ?? feedbackId;
      return Response.json({ ...detail, item: { ...detail.item, id, nickname: id === second ? "第二条" : id === third ? "第三条" : "测试昵称" } });
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await screen.findByRole("heading", { name: "第三条" });
    // The third press lands past the end of the sequence, so it reports the boundary.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已经是最新的一条留言了"));
  });

  it("renders a warmed neighbour without asking for its detail again", async () => {
    const nextId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/live/sequence?") && url.includes("direction=next")) return Response.json({ ok: true, nextFeedbackId: nextId });
      if (url.includes("/live/sequence?")) return Response.json({ ok: true, nextFeedbackId: null });
      if (url.includes(`/live/entries/${nextId}?`)) return Response.json({ ...detail, item: { ...detail.item, id: nextId, nickname: "下一位鹏友" } });
      return original(input, init);
    });
    const detailCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).includes(`/live/entries/${nextId}?`)).length;
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "测试昵称" });

    await waitFor(() => expect(detailCalls()).toBe(1));
    await user.keyboard("{ArrowRight}");
    await screen.findByRole("heading", { name: "下一位鹏友" });
    expect(detailCalls()).toBe(1);
  });
});
