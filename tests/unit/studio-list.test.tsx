import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackListPage } from "../../src/features/studio/pages/FeedbackListPage";

const mocks = vi.hoisted(() => ({
  getFeedbacks: vi.fn(),
  getNewCount: vi.fn(),
  getStats: vi.fn(),
  updateTodo: vi.fn(),
}));

vi.mock("../../src/features/studio/api", () => ({
  getStudioFeedbacks: mocks.getFeedbacks,
  getNewStudioFeedbackCount: mocks.getNewCount,
  getStudioStats: mocks.getStats,
  updateStudioTodo: mocks.updateTodo,
}));

const snapshot = {
  createdAt: 1_000,
  id: "11111111-1111-4111-8111-111111111111",
};
const response = {
  ok: true,
  items: [{
    id: "22222222-2222-4222-8222-222222222222",
    feedbackNumber: "22222222",
    userId: "33333333-3333-4333-8333-333333333333",
    nickname: "页面保持测试",
    topic: "appeal",
    customTopic: null,
    contentPreview: "当前列表不能被轮询自动替换",
    imageCount: 0,
    createdAt: 900,
    status: "unreplied",
    isTodo: false,
    replyCount: 0,
    latestReplyAdmin: null,
  }],
  pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 },
  snapshot,
};

afterEach(() => {
  vi.restoreAllMocks();
  mocks.getFeedbacks.mockReset();
  mocks.getNewCount.mockReset();
  mocks.getStats.mockReset();
  mocks.updateTodo.mockReset();
});

describe("Studio new-feedback polling", () => {
  it("only shows a notice until the administrator explicitly loads the newest page", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const intervalSpy = vi.spyOn(window, "setInterval");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    mocks.getFeedbacks.mockResolvedValue(response);
    mocks.getNewCount.mockResolvedValue({ ok: true, count: 3 });
    mocks.getStats.mockResolvedValue({
      ok: true,
      todayFeedback: 1,
      unreplied: 1,
      todo: 0,
      todayReplied: 0,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/studio/unreplied?snapshotAt=${snapshot.createdAt}&snapshotId=${snapshot.id}`]}>
        <Routes>
          <Route element={<Outlet context={{ liveMode: false }} />}>
            <Route path="/studio/unreplied" element={<FeedbackListPage view="unreplied" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("页面保持测试")).toBeInTheDocument();
    expect(mocks.getFeedbacks).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    const poll = intervalSpy.mock.calls.find(([, delay]) => delay === 20_000)?.[0];
    expect(poll).toBeTypeOf("function");
    await act(async () => {
      if (typeof poll === "function") poll();
      await Promise.resolve();
    });
    expect(await screen.findByText("有 3 条新留言")).toBeInTheDocument();
    expect(screen.getByText("页面保持测试")).toBeInTheDocument();
    expect(mocks.getFeedbacks).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "查看" }));
    await waitFor(() => expect(mocks.getFeedbacks.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.getFeedbacks.mock.calls.some((call) =>
      call[0] === "unreplied" && call[1] === 1 && call[2] === null && call[3] === null,
    )).toBe(true);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("filters the full list by topic and clears the old page snapshot", async () => {
    mocks.getFeedbacks.mockResolvedValue(response);
    mocks.getStats.mockResolvedValue({
      ok: true,
      todayFeedback: 1,
      unreplied: 1,
      todo: 0,
      todayReplied: 0,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/studio/unreplied?page=2&snapshotAt=${snapshot.createdAt}&snapshotId=${snapshot.id}`]}>
        <Routes>
          <Route element={<Outlet context={{ liveMode: false }} />}>
            <Route path="/studio/unreplied" element={<FeedbackListPage view="unreplied" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("页面保持测试");
    await user.selectOptions(screen.getByRole("combobox", { name: "按留言主题筛选" }), "appeal");

    await waitFor(() => expect(mocks.getFeedbacks.mock.calls.some((call) =>
      call[0] === "unreplied" && call[1] === 1 && call[2] === "appeal" && call[3] === null,
    )).toBe(true));
  });
});
