// Snapshot the sanitation contract: every render path imports from
// format.ts, so this test pins the behavior every consumer sees.

import { describe, expect, test } from "vitest";
import { sanitizeReason, brandedMessage, eventLabel } from "./format";

describe("sanitizeReason", () => {
  test("strips em dash to spaced ASCII hyphen", () => {
    expect(sanitizeReason("crosses high-trust threshold — review first")).toBe(
      "crosses high-trust threshold - review first",
    );
  });
  test("strips en dash too", () => {
    expect(sanitizeReason("foo – bar")).toBe("foo - bar");
  });
  test("preserves intra-word hyphens", () => {
    expect(sanitizeReason("high-trust threshold")).toBe("high-trust threshold");
  });
  test("collapses runs of spaces", () => {
    expect(sanitizeReason("a  b   c")).toBe("a b c");
  });
  test("trims edges", () => {
    expect(sanitizeReason("  hello  ")).toBe("hello");
  });
  test("idempotent on already-clean input", () => {
    const s = "crosses high-trust threshold - review first";
    expect(sanitizeReason(sanitizeReason(s))).toBe(s);
  });
  test("undefined / null safe", () => {
    expect(sanitizeReason(undefined)).toBe("");
    expect(sanitizeReason(null)).toBe("");
  });
});

describe("brandedMessage", () => {
  test("prepends [OpenBox]", () => {
    expect(brandedMessage("blocked")).toBe("[OpenBox] blocked");
  });
  test("idempotent if already branded", () => {
    expect(brandedMessage("[OpenBox] blocked")).toBe("[OpenBox] blocked");
  });
  test("strips em dash AND brands", () => {
    expect(brandedMessage("crosses — threshold")).toBe(
      "[OpenBox] crosses - threshold",
    );
  });
  test("empty input → bare prefix", () => {
    expect(brandedMessage("")).toBe("[OpenBox]");
    expect(brandedMessage(undefined)).toBe("[OpenBox]");
  });
});

describe("eventLabel", () => {
  test.each([
    ["beforeShellExecution", "Shell command"],
    ["beforeReadFile", "File read"],
    ["beforeMCPExecution", "MCP tool call"],
    ["beforeSubmitPrompt", "Prompt submission"],
    ["preToolUse", "Tool call"],
    ["someUnknownEvent", "someUnknownEvent"],
    [undefined, "Action"],
  ])("eventLabel(%j) = %j", (input, expected) => {
    expect(eventLabel(input ?? null)).toBe(expected);
  });
});
