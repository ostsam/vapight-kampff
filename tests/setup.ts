import { afterEach, vi } from "vitest";
import { setDbForTesting } from "@/lib/server/db/client";
import { resetEnvCache } from "@/lib/server/env";

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  setDbForTesting(null);
});
