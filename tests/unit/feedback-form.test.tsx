import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FeedbackForm } from "../../src/features/feedback/FeedbackForm";

const config = {
  turnstileSiteKey: "1x00000000000000000000AA",
  privacyPolicyVersion: "2026-09-03",
  livestreamPolicyVersion: "2026-09-03",
};

describe("feedback form", () => {
  it("uses the required visible order and keeps phone and OTP out of the form", async () => {
    render(<MemoryRouter><FeedbackForm config={config} /></MemoryRouter>);
    const labels = ["留言主题", "留言内容", "抖音昵称", "上传图片"];
    const positions = labels.map((label) => document.body.textContent!.indexOf(label));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(screen.queryByText("手机号")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /未开启/u })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "选择图片" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reveals the custom topic only after selecting other", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackForm config={config} /></MemoryRouter>);
    expect(screen.queryByLabelText("请填写留言主题")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /留言主题/ }), "other");
    expect(screen.getByRole("textbox", { name: /请填写留言主题/ })).toBeInTheDocument();
  });

  it("moves focus to the first invalid control and exposes acknowledgement errors", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackForm config={config} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "提交留言" }));

    const firstField = screen.getByRole("combobox", { name: /留言主题/ });
    await waitFor(() => expect(firstField).toHaveFocus());
    expect(firstField).toHaveAttribute("aria-describedby", "topic-error");

    const privacy = screen.getByRole("checkbox", { name: "我已阅读并同意" });
    expect(privacy).toHaveAttribute("aria-invalid", "true");
    expect(privacy).toHaveAttribute("aria-describedby", "privacy-agreed-error");
    expect(screen.getByRole("button", { name: "《隐私政策》" }).closest("label")).toBeNull();
  });
});
