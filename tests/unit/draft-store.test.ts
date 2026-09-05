import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraftImages,
  EMPTY_DRAFT,
  loadDraft,
  loadDraftImages,
  saveDraft,
  saveDraftImage,
  markDraftSubmitted,
} from "../../src/features/feedback/draft-store";

describe("local draft storage", () => {
  it("never restores or re-saves a completed draft", () => {
    const draft = { ...EMPTY_DRAFT(), content: "已提交" };
    saveDraft(draft);
    markDraftSubmitted(draft.submissionKey);
    expect(loadDraft()).toBeNull();
    expect(saveDraft(draft)).toBe(false);
  });

  it("scopes images to a draft and adopts legacy images only when requested", async () => {
    const image = { id: "scoped", blob: new Blob(["image"]), name: "test.webp", width: 1, height: 1, byteSize: 5 };
    await saveDraftImage(image);
    expect(await loadDraftImages("new-draft")).toHaveLength(0);
    expect(await loadDraftImages("original-draft", true)).toHaveLength(1);
    expect(await loadDraftImages("new-draft")).toHaveLength(0);
    await clearDraftImages("new-draft");
    expect(await loadDraftImages("original-draft")).toHaveLength(1);
  });
  beforeEach(async () => {
    await clearDraftImages().catch(() => undefined);
  });

  it("restores text and acknowledgement state from localStorage", () => {
    const draft = {
      ...EMPTY_DRAFT(),
      topic: "released_hardware" as const,
      content: "保留中的草稿",
      nickname: "测试昵称",
      imagesEnabled: true,
      privacyAgreed: true,
    };
    saveDraft(draft);
    expect(loadDraft()).toMatchObject({
      topic: "released_hardware",
      content: "保留中的草稿",
      nickname: "测试昵称",
      imagesEnabled: true,
      privacyAgreed: true,
    });
  });

  it("stores processed images in IndexedDB", async () => {
    await saveDraftImage({
      id: "image-1",
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
      name: "draft.webp",
      width: 10,
      height: 10,
      byteSize: 3,
    });
    const images = await loadDraftImages();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ id: "image-1", width: 10, height: 10, byteSize: 3 });
  });
});
