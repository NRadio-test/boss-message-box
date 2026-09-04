import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "../../src/features/history/HistoryPage";

afterEach(() => vi.unstubAllGlobals());

describe("public history replies", () => {
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
