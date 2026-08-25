import { describe, expect, it } from "vitest";
import { isValidBranchName, slugify, suggestBranchName } from "../src/branch.js";
import type { Classification } from "../src/types.js";

const base: Classification = {
  type: "feat",
  scope: "commit-flow",
  isBreaking: false,
  confidence: "high",
  ticketId: null,
  reasons: [],
};

describe("branch", () => {
  it("slugifies titles", () => {
    expect(slugify("Add Classify CLI!")).toBe("add-classify-cli");
  });

  it("suggests type/scope-slug", () => {
    expect(suggestBranchName(base, "add classify CLI")).toBe(
      "feat/commit-flow-add-classify-cli",
    );
  });

  it("prefers ticket in name", () => {
    expect(
      suggestBranchName(
        { ...base, ticketId: "AUTH-12" },
        "fix login",
      ),
    ).toBe("feat/AUTH-12-fix-login");
  });

  it("uses explicit ticketId parameter over classification", () => {
    expect(
      suggestBranchName(base, "fix login", "PROJ-42"),
    ).toBe("feat/PROJ-42-fix-login");
  });

  it("falls back to change when title is empty", () => {
    expect(suggestBranchName(base, "")).toBe("feat/commit-flow-change");
  });

  it("validates branch names", () => {
    expect(isValidBranchName("feat/foo-bar")).toBe(true);
    expect(isValidBranchName("../evil")).toBe(false);
  });
});
