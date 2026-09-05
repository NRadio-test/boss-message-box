import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, Routes, MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FeedbackDetailPage } from "../../src/features/studio/pages/FeedbackDetailPage";

const feedbackId = "22222222-2222-4222-8222-222222222222";
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

afterEach(() => vi.unstubAllGlobals());

function renderDetail(liveMode: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/studio/feedback/${feedbackId}${liveMode ? "?mode=live" : ""}`]}>
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
  });

  it("saves a nonempty live reply before advancing", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "直播回复内容");
    await user.click(screen.getByRole("button", { name: "下一条" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ content: "直播回复内容", requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it("advances without creating a reply when the live reply is empty", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    await user.click(screen.getByRole("button", { name: "下一条" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "已经是最后一条" })).toBeDisabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("still saves a reply entered after reaching the final live message", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    await user.click(screen.getByRole("button", { name: "下一条" }));
    await screen.findByRole("button", { name: "已经是最后一条" });
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "最后一条也需要回复");
    await user.click(screen.getByRole("button", { name: "保存回复" }));

    await screen.findByText("回复已保存，已经是最后一条了");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.getByText("最后一条也需要回复")).toBeInTheDocument();
  });

  it("retries an uncertain reply with the same request key and locked content", async () => {
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    let shouldFail = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && shouldFail) {
        shouldFail = false;
        throw new TypeError("Failed to fetch");
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    const input = screen.getByRole("textbox", { name: "回复内容" });
    await user.type(input, "只保存一次");
    await user.click(screen.getByRole("button", { name: "下一条" }));
    await screen.findByRole("alert");
    expect(input).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下一条" }));
    await screen.findByRole("button", { name: "已经是最后一条" });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.[1]?.body).toEqual(posts[1]?.[1]?.body);
    expect(input).not.toBeDisabled();
  });

  it("does not repeat a confirmed reply when loading the next message fails", async () => {
    const fetchMock = mockDetailApi();
    const original = fetchMock.getMockImplementation()!;
    let shouldFail = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes("/next?") && shouldFail) {
        shouldFail = false;
        throw new TypeError("Failed to fetch");
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "已确认保存");
    await user.click(screen.getByRole("button", { name: "下一条" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "回复内容" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "下一条" }));
    await screen.findByRole("button", { name: "已经是最后一条" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
