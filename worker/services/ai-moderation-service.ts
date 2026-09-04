import type { AiModerationProvider, FeedbackRepository } from "../core/ports";

export class AiModerationService {
  constructor(
    private readonly dependencies: {
      provider: AiModerationProvider;
      feedback: FeedbackRepository;
    },
  ) {}

  async moderate(input: {
    feedbackId: string;
    topic: string;
    content: string;
    now: number;
  }): Promise<void> {
    try {
      const decision = await this.dependencies.provider.classify({
        topic: input.topic,
        content: input.content,
      });
      await this.dependencies.feedback.setModerationResult({
        feedbackId: input.feedbackId,
        status: decision.decision === "filter" ? "filtered" : "kept",
        category: decision.category,
        reason: decision.reason,
        now: input.now,
      });
    } catch (error) {
      try {
        await this.dependencies.feedback.setModerationResult({
          feedbackId: input.feedbackId,
          status: "failed",
          category: null,
          reason: "provider_error",
          now: input.now,
        });
      } catch (persistenceError) {
        console.warn("Unable to persist AI moderation failure", {
          feedbackId: input.feedbackId,
          kind: persistenceError instanceof Error ? persistenceError.name : "UnknownError",
        });
      }
      console.warn("AI moderation failed open", {
        feedbackId: input.feedbackId,
        kind: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
