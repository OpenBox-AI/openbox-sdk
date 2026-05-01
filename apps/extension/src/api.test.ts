// Smoke tests for the extension's API adapter. We don't test OpenBoxClient
// itself; that's openbox-sdk's job. We verify the wiring: the right env
// URL, the right clientName, and the right token coming out of the env-
// namespaced ~/.openbox/tokens parser.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ENVIRONMENTS } from "openbox-sdk/env";

// SDK isTokenExpired() rejects malformed tokens, so test fixtures need to
// be real-shaped JWTs with a future exp claim.
function makeJwt(envTag: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: `${envTag}-user`, exp })).toString("base64url");
  return `${header}.${payload}.sig-${envTag}`;
}

const PROD_TOKEN = makeJwt("prod");
const STAGING_TOKEN = makeJwt("staging");
const LOCAL_TOKEN = makeJwt("local");
const FAKE_TOKENS = `production.ACCESS_TOKEN=${PROD_TOKEN}
production.REFRESH_TOKEN=prod-refresh
production.UPDATED_AT=2026-04-25T00:00:00Z
staging.ACCESS_TOKEN=${STAGING_TOKEN}
staging.REFRESH_TOKEN=staging-refresh
staging.UPDATED_AT=2026-04-25T00:00:00Z
local.ACCESS_TOKEN=${LOCAL_TOKEN}
local.REFRESH_TOKEN=local-refresh
local.UPDATED_AT=2026-04-25T00:00:00Z
`;
const TOKEN_BY_ENV: Record<string, string> = {
  production: PROD_TOKEN,
  staging: STAGING_TOKEN,
  local: LOCAL_TOKEN,
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
    it(`hits the ${env} apiUrl with the right token + clientName`, async () => {
      const client = createApi(env);
      await client.health();

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith(ENVIRONMENTS[env].apiUrl)).toBe(true);

      const headers = init.headers as Record<string, string>;
      expect(headers["X-Openbox-Client"]).toBe("apps/extension");
      expect(headers["Authorization"]).toBe(`Bearer ${TOKEN_BY_ENV[env]}`);
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
