import type { ImageCleanupRepository, ImageStorage } from "../core/ports";

const MAX_BATCH = 50;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export class ImageCleanupService {
  constructor(
    private readonly repository: ImageCleanupRepository,
    private readonly storage: ImageStorage,
  ) {}

  async run(now: number): Promise<void> {
    const records = await this.repository.listDue(now, MAX_BATCH);
    await Promise.all(
      records.map(async (record) => {
        try {
          // Delayed rows may represent an uncertain D1 response. Never delete
          // an object that the final feedback transaction ended up referencing.
          if (!(await this.repository.isReferenced(record.objectKey))) {
            await this.storage.delete(record.objectKey);
          }
          await this.repository.complete(record.objectKey);
        } catch (error) {
          const delay = Math.min(
            MAX_RETRY_DELAY_MS,
            60_000 * 2 ** Math.min(record.attemptCount, 8),
          );
          const errorCode = error instanceof Error ? error.name : "unknown";
          await this.repository.retry(record.objectKey, now + delay, errorCode, now);
        }
      }),
    );
  }
}
