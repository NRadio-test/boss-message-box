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

  it("submits directly with a locked live reply type in live mode", async () => {
    const fetchMock = mockDetailApi();
    const user = userEvent.setup();
    renderDetail(true);
    await screen.findByRole("heading", { name: "申冤" });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "回复内容" }), "直播回复内容");
    await user.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ content: "直播回复内容" });
  });
});
