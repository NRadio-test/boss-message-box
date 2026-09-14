import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEntryCard } from "../../src/features/studio/components/LiveEntryCard";
import { replyCountLabel } from "../../src/features/studio/reply-count";
import { captureReturnContext, loadListReturn, saveListReturn } from "../../src/features/studio/navigation-context";
import type { LiveEntry } from "../../src/shared/live-contracts";

afterEach(() => vi.restoreAllMocks());
describe("live card navigation", () => {
  it.each([[0, "未回复"], [1, "已回复·一条"], [2, "已回复·两条"], [10, "已回复·十条"], [12, "已回复·十二条"], [21, "已回复·二十一条"], [101, "已回复·一百零一条"], [110, "已回复·一百一十条"]])("formats %s replies", (count, label) => {
    expect(replyCountLabel(Number(count))).toBe(label);
  });
  it("keeps row actions separate from the detail link and measures long content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
    const onOpen = vi.fn(event => event.preventDefault()); const onExpand = vi.fn(); const onRemove = vi.fn();
    const item = { id: "entry", feedbackId: "feedback", sourceType: "public", nickname: "测试昵称", topic: "appeal", content: "长留言", createdAt: 1, imageCount: 0, replyCount: 2 } as LiveEntry;
    render(<MemoryRouter><LiveEntryCard item={item} batchId="batch" archived={false} disabled={false} expanded={false}
      onOpen={onOpen} onExpand={onExpand} onRemove={onRemove}>{null}</LiveEntryCard></MemoryRouter>);
    expect(screen.queryByText("查看原留言与回复")).not.toBeInTheDocument();
    expect(screen.getByText("已回复·两条")).toHaveClass("studio-status--replied");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "展开全文" }));
    await user.click(screen.getByRole("button", { name: "取消直播展示" }));
    expect(onExpand).toHaveBeenCalledTimes(1); expect(onRemove).toHaveBeenCalledTimes(1); expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "查看测试昵称的留言详情" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/studio/feedback/feedback?view=live_display");
  });
  it("stores anchors and expanded rows by history entry, without storing message content", () => {
    const context = { ...captureReturnContext("/studio/live-display?page=2", "8", ["6", "7", "8", "9"], null), expandedIds: ["7"], batchId: "batch" };
    saveListReturn("history-a", context);
    saveListReturn("history-b", { url: "/studio/live-display?page=3", anchorId: "40" });
    expect(loadListReturn("history-a")).toEqual(context);
    expect(loadListReturn("history-b")?.anchorId).toBe("40");
    expect(loadListReturn("missing")).toBeNull();
  });
});
