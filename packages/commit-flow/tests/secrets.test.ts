import { describe, expect, it } from "vitest";
import { findSecretFiles, looksLikeSecret } from "../src/secrets.js";

describe("secrets", () => {
  it("detects .env variants", () => {
    expect(looksLikeSecret(".env")).toBe(true);
    expect(looksLikeSecret("apps/web/.env.local")).toBe(true);
    expect(looksLikeSecret("src/config.ts")).toBe(false);
  });

  it("filters list", () => {
    expect(
      findSecretFiles(["src/a.ts", "credentials.json", "README.md"]),
    ).toEqual(["credentials.json"]);
  });
});
