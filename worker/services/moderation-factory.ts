import type { Env } from "../env";
import { D1ModerationJobRepository } from "../infra/d1-moderation-jobs";
import { D1FeedbackRepository } from "../infra/d1-repositories";
import { createAiModerationProvider } from "../providers/ai-moderation";
import { AiModerationService } from "./ai-moderation-service";

export function createAiModerationService(env: Env): AiModerationService {
  return new AiModerationService({
    feedback: new D1FeedbackRepository(env.BOSS_MESSAGE_DB),
    jobs: new D1ModerationJobRepository(env.BOSS_MESSAGE_DB),
    provider: createAiModerationProvider({
      baseUrl: env.AI_BASE_URL,
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      thinking: env.AI_THINKING,
    }),
  });
}
