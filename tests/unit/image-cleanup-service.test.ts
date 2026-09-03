// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ImageCleanupRepository, ImageStorage } from "../../worker/core/ports";
import { ImageCleanupService } from "../../worker/services/image-cleanup-service";

function setup(referenced: boolean, deleteFailure = false) {
  const repository: ImageCleanupRepository = {
    enqueue: vi.fn(),
    listDue: vi.fn().mockResolvedValue([{ objectKey: "feedback-images/orphan.webp", attemptCount: 0 }]),
    isReferenced: vi.fn().mockResolvedValue(referenced),
    complete: vi.fn(),
    retry: vi.fn(),
  };
  const storage: ImageStorage = {
    putPrivate: vi.fn(),
    delete: deleteFailure ? vi.fn().mockRejectedValue(new Error("R2 unavailable")) : vi.fn(),
  };
  return { repository, storage, service: new ImageCleanupService(repository, storage) };
}

describe("delayed image cleanup", () => {
  it("removes an unreferenced object and completes its queue row", async () => {
    const { repository, storage, service } = setup(false);
    await service.run(1_800_000_000_000);
    expect(storage.delete).toHaveBeenCalledWith("feedback-images/orphan.webp");
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("never deletes an object that a committed feedback row references", async () => {
    const { repository, storage, service } = setup(true);
    await service.run(1_800_000_000_000);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("persists an exponential retry after an R2 failure", async () => {
    const { repository, service } = setup(false, true);
    await service.run(1_800_000_000_000);
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.retry).toHaveBeenCalledWith(
      "feedback-images/orphan.webp",
      1_800_000_060_000,
      "Error",
      1_800_000_000_000,
    );
  });
});
