import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "../../src/features/history/HistoryPage";

afterEach(() => vi.unstubAllGlobals());

describe("public history replies", () => {
  it("loads later pages with the original nickname and cursor", async () => {
    const first = { id: crypto.randomUUID(), createdAt: 10, topic: "appeal", customTopic: null, content: "第一批留言", imageCount: 0, status: "unreplied", replies: [], replyContent: null };
    const second = { ...first, id: crypto.randomUUID(), createdAt: 9, content: "第二批留言" };
    const cursor = { id: first.id, createdAt: first.createdAt };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, items: [first], nextCursor: cursor }))).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, items: [second], nextCursor: null })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.type(screen.getByRole("textbox", { name: /抖音昵称/u }), "原昵称");
    await user.click(screen.getByRole("button", { name: "查询留言" }));
    await screen.findByText("第一批留言");
    await user.clear(screen.getByRole("textbox", { name: /抖音昵称/u }));
    await user.type(screen.getByRole("textbox", { name: /抖音昵称/u }), "其他昵称");
    await user.click(screen.getByRole("button", { name: "加载更多留言" }));
    expect(await screen.findByText("第二批留言")).toBeInTheDocument();
    expect(screen.getByText("第一批留言")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ nickname: "原昵称", before: cursor });
    expect(screen.queryByRole("button", { name: "加载更多留言" })).not.toBeInTheDocument();
  });
  it("renders every reply oldest first without exposing Studio administrator names", async () => {
    const createdAt = Date.UTC(2026, 8, 3, 9, 0, 0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      items: [{
        id: "e2217b04-ff96-46aa-ac7e-61a4e86ea411",
        topic: "appeal",
        customTopic: null,
        content: "用户留言",
        imageCount: 0,
        status: "replied",
        createdAt,
        replyContent: "第二条",
        replies: [
          { id: "one", replyType: "live", content: "第一条", createdAt },
          { id: "two", replyType: "message", content: "第二条", createdAt: createdAt + 1_000 },
        ],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.type(screen.getByRole("textbox", { name: /抖音昵称/u }), "测试昵称");
    await user.click(screen.getByRole("button", { name: "查询留言" }));

    const replyBlocks = await screen.findAllByText("官方回复");
    expect(replyBlocks).toHaveLength(2);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("第一条")).toBeLessThan(text.indexOf("第二条"));
    expect(screen.getByText(/直播回复/u)).toBeInTheDocument();
    expect(screen.getByText(/留言回复/u)).toBeInTheDocument();
    expect(text).not.toContain("admin-zd");
    expect(text).not.toContain("fa");
    const request = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ nickname: "测试昵称" });
  });
});
