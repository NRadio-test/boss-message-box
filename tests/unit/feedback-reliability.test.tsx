import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FeedbackForm } from "../../src/features/feedback/FeedbackForm";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), compress: vi.fn(), clearImages: vi.fn(), saveImage: vi.fn(), saveIdentity: vi.fn() }));
vi.mock("../../src/lib/api", async (original) => ({ ...await original<typeof import("../../src/lib/api")>(), submitFeedback: mocks.submit }));
vi.mock("../../src/features/feedback/image-compression", () => ({ compressImage: mocks.compress }));
vi.mock("../../src/features/feedback/draft-store", async (original) => ({
  ...await original<typeof import("../../src/features/feedback/draft-store")>(),
  loadDraft: () => ({ submissionKey: crypto.randomUUID(), imagesVersion: 2, topic: "appeal", customTopic: null, content: "待提交内容", nickname: "回归测试", imagesEnabled: true, privacyAgreed: true, livestreamAgreed: true, updatedAt: 1 }),
  loadDraftImages: async () => [], clearDraftImages: mocks.clearImages, saveDraftImage: mocks.saveImage, saveIdentity: mocks.saveIdentity,
}));
vi.mock("../../src/components/TurnstileWidget", () => ({
  TurnstileWidget: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ getToken: async () => "fixture-token", reset: () => undefined }));
    return null;
  }),
}));
const config = { turnstileSiteKey: "test", privacyPolicyVersion: "test", livestreamPolicyVersion: "test" };
const compressed = { blob: new Blob(["processed"], { type: "image/webp" }), width: 10, height: 10 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearImages.mockResolvedValue(undefined);
  mocks.saveImage.mockResolvedValue(undefined);
  mocks.saveIdentity.mockImplementation(() => undefined);
  mocks.compress.mockResolvedValue(compressed);
  mocks.submit.mockResolvedValue({ ok: true, feedbackId: "created", createdAt: 1, idempotent: false });
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:test"; } static revokeObjectURL() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  render(<MemoryRouter><Routes><Route path="/" element={<FeedbackForm config={config} />} /><Route path="/success" element={<h1>提交已完成</h1>} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "提交留言" })).toBeEnabled());
}
function chooseImage() {
  fireEvent.change(document.getElementById("images")!, { target: { files: [new File(["image"], "test.jpg", { type: "image/jpeg" })] } });
}

it("waits for compression and sends the processed attachment", async () => {
  let finish!: (value: typeof compressed) => void;
  mocks.compress.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  chooseImage();
  expect(await screen.findByText("图片处理完成后即可提交")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提交留言" })).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
  await act(async () => finish(compressed));
  await waitFor(() => expect(screen.getByRole("button", { name: "提交留言" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  await screen.findByText("提交已完成");
  expect(mocks.submit.mock.calls[0]![1]).toHaveLength(1);
});

it("keeps an attachment in memory when IndexedDB saving fails", async () => {
  mocks.saveImage.mockRejectedValueOnce(new Error("quota"));
  await mount();
  chooseImage();
  await screen.findByText(/图片仍可正常提交/u);
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  await screen.findByText("提交已完成");
  expect(mocks.submit.mock.calls[0]![1]).toHaveLength(1);
});

it("does not turn confirmed server success into failure when browser cleanup fails", async () => {
  mocks.clearImages.mockRejectedValueOnce(new Error("IndexedDB cleanup failed"));
  mocks.saveIdentity.mockImplementationOnce(() => { throw new Error("localStorage unavailable"); });
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  expect(await screen.findByText("提交已完成")).toBeInTheDocument();
  expect(screen.queryByText("IndexedDB cleanup failed")).not.toBeInTheDocument();
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it("cancels an in-flight attachment when upload is toggled off", async () => {
  let finish!: (value: typeof compressed) => void;
  mocks.compress.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  chooseImage();
  await screen.findByText("图片处理完成后即可提交");
  const signal = mocks.compress.mock.calls[0]![1] as AbortSignal;
  await userEvent.click(screen.getByRole("switch"));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(compressed));
  expect(mocks.saveImage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  await screen.findByText("提交已完成");
  expect(mocks.submit.mock.calls[0]![1]).toHaveLength(0);
});

it("retries an uncertain submission with the same key and frozen content", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("网络超时"));
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  await screen.findByText("网络超时");
  expect(screen.getByRole("textbox", { name: /留言内容/u })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "提交留言" }));
  await screen.findByText("提交已完成");
  expect(mocks.submit.mock.calls[1]![0]).toEqual(mocks.submit.mock.calls[0]![0]);
});
