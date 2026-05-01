// Smoke tests for the extension's API adapter. We don't test OpenBoxClient
// itself; that's openbox-sdk's job. We verify the wiring: the right env
// URL, the right clientName, and the right X-API-Key coming out of the
// env-namespaced ~/.openbox/tokens parser.
//
// Auth contract: the extension reads `<env>.API_KEY=...` from the same
// token store the CLI manages (`openbox auth set-api-key`). The CLI
// handoff is the only auth surface; the extension never sets an
// `Authorization: Bearer` header.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ENVIRONMENTS } from "openbox-sdk/env";

// `obx_key_<48hex>` is the org-key shape; the SDK validates it before
// sending any request.
function makeApiKey(envTag: string): string {
  const padded = envTag.padEnd(48, "0").slice(0, 48);
  return `obx_key_${padded.replace(/[^a-f0-9]/g, "0")}`;
}

const PROD_KEY = makeApiKey("aabbccdd");
const STAGING_KEY = makeApiKey("11223344");
const LOCAL_KEY = makeApiKey("55667788");
const FAKE_TOKENS = `production.API_KEY=${PROD_KEY}
production.UPDATED_AT=2026-04-25T00:00:00Z
staging.API_KEY=${STAGING_KEY}
staging.UPDATED_AT=2026-04-25T00:00:00Z
local.API_KEY=${LOCAL_KEY}
local.UPDATED_AT=2026-04-25T00:00:00Z
`;
const KEY_BY_ENV: Record<string, string> = {
  production: PROD_KEY,
  staging: STAGING_KEY,
  local: LOCAL_KEY,
};

// Module-level mocks: the api adapter reads home dir + token file at import
// time-equivalent (each createApi call). vi.spyOn doesn't work on `os` /
// `fs` namespace imports under ESM, so we mock the modules outright.
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return { ...actual, homedir: () => "/tmp/fake-home" };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: (p: any) => {
      const s = String(p);
      return s.endsWith("/tokens") || s.endsWith("/.openbox");
    },
    readFileSync: () => FAKE_TOKENS,
    mkdirSync: () => undefined,
    writeFileSync: () => undefined,
  };
});

// vi.mock calls are hoisted above this import so the api adapter's `os`/`fs`
// references resolve to the mocked versions at module init.
import { createApi } from "./api";

describe("createApi", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalCwd = process.cwd;

  beforeEach(() => {
    process.cwd = () => "/tmp/no-tokens-here";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.cwd = originalCwd;
  });

  for (const env of ["production", "staging", "local"] as const) {
    it(`hits the ${env} apiUrl with the right key + clientName`, async () => {
      const client = createApi(env);
      await client.health();

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith(ENVIRONMENTS[env].apiUrl)).toBe(true);

      const headers = init.headers as Record<string, string>;
      expect(headers["X-Openbox-Client"]).toBe("apps/extension");
      expect(headers["X-API-Key"]).toBe(KEY_BY_ENV[env]);
      // X-API-Key is the only auth header the extension ever sends.
      expect(headers["Authorization"]).toBeUndefined();
    });
  }

  it("appends OPENBOX_CLIENT_VARIANT to the header", async () => {
    const orig = process.env.OPENBOX_CLIENT_VARIANT;
    process.env.OPENBOX_CLIENT_VARIANT = "claude-code";
    try {
      const client = createApi("production");
      await client.health();
      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers["X-Openbox-Client"]).toBe("apps/extension/claude-code");
    } finally {
      if (orig === undefined) delete process.env.OPENBOX_CLIENT_VARIANT;
      else process.env.OPENBOX_CLIENT_VARIANT = orig;
    }
  });
});
