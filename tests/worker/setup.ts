import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  // Module augmentation follows Cloudflare's generated Env declaration shape.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      BOSS_MESSAGE_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.BOSS_MESSAGE_DB, env.TEST_MIGRATIONS);
