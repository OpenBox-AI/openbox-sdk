import { describe, expect, test, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { loadFilters } from "./filters";

function state(value: unknown) {
  return {
    get: () => value,
  } as any;
}

describe("loadFilters", () => {
  test("history drops stale pending status filters", () => {
    const filters = loadFilters(
      state({ status: "pending", sort: "newest", dateRange: "all" }),
      "history",
      "production",
    );
    expect(filters.status).toBeUndefined();
  });

  test("history keeps decided status filters", () => {
    const filters = loadFilters(
      state({ status: "approved", sort: "newest", dateRange: "all" }),
      "history",
      "production",
    );
    expect(filters.status).toBe("approved");
  });

  test("pending view does not load a status filter from storage", () => {
    const filters = loadFilters(
      state({ status: "approved", sort: "newest", dateRange: "all" }),
      "pending",
      "production",
    );
    expect(filters.status).toBeUndefined();
  });
});
