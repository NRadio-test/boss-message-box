import type { AiModerationProvider, FeedbackRepository, ModerationJob, ModerationJobRepository } from "../core/ports";
import { AiModerationProviderError } from "../providers/ai-moderation";

export class AiModerationService {
  constructor(
    private readonly dependencies: {
      provider: AiModerationProvider;
      feedback: FeedbackRepository;
      jobs: ModerationJobRepository;
      now?: () => number;
    },
  ) {}

  async start(input: { feedbackId: string; now: number; manual?: boolean }): Promise<(() => Promise<void>) | null> {
    const job = await this.dependencies.jobs.claim(input);
    return job ? () => this.run(job) : null;
  }

  async moderate(input: { feedbackId: string; now: number }): Promise<void> {
    try {
      const task = await this.start(input);
      if (task) await task();
    } catch {
      console.warn("AI moderation job deferred", { feedbackId: input.feedbackId, kind: "storage_error" });
    }
  }

  async recover(now: number, limit = 5): Promise<void> {
    await this.dependencies.jobs.expireExhausted(now);
    const ids = await this.dependencies.jobs.listDue(now, limit);
    await Promise.all(ids.map((feedbackId) => this.moderate({ feedbackId, now })));
  }

  private async run(job: ModerationJob): Promise<void> {
    let result: Parameters<FeedbackRepository["setModerationResult"]>[0];
    try {
      const decision = await this.dependencies.provider.classify({ topic: job.topic, content: job.content });
      result = {
        feedbackId: job.feedbackId,
        attemptToken: job.attemptToken,
        status: decision.decision === "filter" ? "filtered" : "kept",
        category: decision.category,
        reason: decision.reason,
        now: this.now(),
      };
    } catch (error) {
      const reason = error instanceof AiModerationProviderError ? error.code : "provider_error";
      const now = this.now();
      result = {
        feedbackId: job.feedbackId,
        attemptToken: job.attemptToken,
        status: "failed", category: null, reason, now,
        nextRetryAt: now + 60_000 * 2 ** Math.min(job.attempts - 1, 2),
      };
      console.warn("AI moderation failed open", { feedbackId: job.feedbackId, kind: reason });
    }
    // Token, reply and manual-state guards prevent late responses overwriting human work.
    await this.dependencies.feedback.setModerationResult(result);
  }

  private now(): number {
    return (this.dependencies.now ?? Date.now)();
  }
}
