import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraftImages,
  EMPTY_DRAFT,
  loadDraft,
  loadDraftImages,
  saveDraft,
  saveDraftImage,
} from "../../src/features/feedback/draft-store";

describe("local draft storage", () => {
  beforeEach(async () => {
    await clearDraftImages().catch(() => undefined);
  });

  it("restores text and acknowledgement state from localStorage", () => {
    const draft = {
      ...EMPTY_DRAFT(),
      topic: "released_hardware" as const,
      content: "保留中的草稿",
      phone: "13800138000",
      privacyAgreed: true,
    };
    saveDraft(draft);
    expect(loadDraft()).toMatchObject({
      topic: "released_hardware",
      content: "保留中的草稿",
      phone: "13800138000",
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
