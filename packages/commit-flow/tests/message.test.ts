import { describe, expect, it } from "vitest";
import {
  buildCommitMessage,
  formatSubject,
  parseNumstat,
} from "../src/message.js";
import type { Classification } from "../src/types.js";

const base: Classification = {
  type: "feat",
  scope: "commit-flow",
  isBreaking: false,
  confidence: "high",
  ticketId: null,
  reasons: ["Changes add new functionality"],
};

describe("message", () => {
  it("formats subject with scope", () => {
    expect(formatSubject(base, "add classify CLI")).toBe(
      "feat(commit-flow): add classify CLI",
    );
  });

  it("formats breaking subject", () => {
    expect(
      formatSubject({ ...base, isBreaking: true }, "rename API"),
    ).toBe("feat(commit-flow)!: rename API");
  });

  it("builds body with why and impact", () => {
    const msg = buildCommitMessage({
      classification: base,
      title: "add classify CLI",
      why: "Port smart-commit into marketplace.\n\n- add classify\n- add commands",
      impact: "- Agents get /commit-push workflow",
      stats: { files: 3, added: 100, removed: 2 },
      coAuthor: "Claude <noreply@anthropic.com>",
    });
    expect(msg).toContain("feat(commit-flow): add classify CLI");
    expect(msg).toContain("Port smart-commit");
    expect(msg).toContain("Summary:");
    expect(msg).toContain("Impact:");
    expect(msg).toContain("Co-authored-by: Claude");
  });

  it("omits Co-authored-by when coAuthor not provided", () => {
    const msg = buildCommitMessage({
      classification: base,
      title: "add classify CLI",
    });
    expect(msg).not.toContain("Co-authored-by");
  });

  it("parses numstat", () => {
    expect(parseNumstat("10\t2\ta.ts\n3\t0\tb.ts\n")).toEqual({
      files: 2,
      added: 13,
      removed: 2,
    });
  });
});
