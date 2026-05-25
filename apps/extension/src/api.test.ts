// Smoke tests for the extension's API adapter. We don't test OpenBoxClient
// itself; that's openbox-sdk's job. We verify the wiring: configured URLs,
// clientName, and the X-API-Key coming out of the flat ~/.openbox/tokens parser.
//
// Auth contract: the extension reads `API_KEY=...` from the same token store
// the CLI manages (`openbox auth set-api-key`). The CLI handoff is the only
// auth surface; the extension never sets an `Authorization: Bearer` header.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `obx_key_<48hex>` is the org-key shape; the SDK validates it before
// sending any request.
function makeApiKey(envTag: string): string {
  const padded = envTag.padEnd(48, "0").slice(0, 48);
  return `obx_key_${padded.replace(/[^a-f0-9]/g, "0")}`;
}

const API_KEY = makeApiKey("aabbccdd");
const FAKE_TOKENS = `API_KEY=${API_KEY}
UPDATED_AT=2026-04-25T00:00:00Z
`;

// Module-level mocks: the api adapter reads home dir + token file at import
// time-equivalent (each createApi call). vi.spyOn doesn't work on `os` /
// `fs` namespace imports under ESM, so we mock the modules outright.
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return { ...actual, homedir: () => "/tmp/fake-home" };
});
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return { ...actual, homedir: () => "/tmp/fake-home" };
});

vi.mock("node:fs", async () => {
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
    process.env.OPENBOX_API_URL = "https://api.example.test/ob";
    process.env.OPENBOX_CORE_URL = "https://core.example.test/ob";
    process.env.OPENBOX_API_KEY = API_KEY;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.cwd = originalCwd;
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
    delete process.env.OPENBOX_API_KEY;
  });

  it("hits the configured apiUrl with the right key + clientName", async () => {
    const client = await createApi();
    await client.health();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://api.example.test/ob")).toBe(true);

    const headers = init.headers as Record<string, string>;
    expect(headers["X-Openbox-Client"]).toBe("apps/extension");
    expect(headers["X-API-Key"]).toBe(API_KEY);
    // X-API-Key is the only auth header the extension ever sends.
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("appends OPENBOX_CLIENT_VARIANT to the header", async () => {
    const orig = process.env.OPENBOX_CLIENT_VARIANT;
    process.env.OPENBOX_CLIENT_VARIANT = "claude-code";
    try {
      const client = await createApi();
      await client.health();
      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers["X-Openbox-Client"]).toBe("apps/extension/claude-code");
    } finally {
      if (orig === undefined) delete process.env.OPENBOX_CLIENT_VARIANT;
      else process.env.OPENBOX_CLIENT_VARIANT = orig;
    }
  });
});
