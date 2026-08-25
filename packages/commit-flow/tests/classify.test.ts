import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.js";

describe("classify", () => {
  it("classifies fix from diff keywords", () => {
    const r = classify({
      files: ["src/auth.ts"],
      diff: "+ fix null token crash in validate()\n",
      branch: "fix/AUTH-12-login",
    });
    expect(r.type).toBe("fix");
    expect(r.ticketId).toBe("AUTH-12");
    expect(r.scope).toBe("auth");
    expect(r.confidence).toBe("high");
  });

  it("classifies docs when only markdown changed", () => {
    const r = classify({
      files: ["README.md", "docs/design.md"],
      diff: "+ more docs\n",
    });
    expect(r.type).toBe("docs");
  });

  it("classifies test when only test files", () => {
    const r = classify({
      files: ["src/foo.test.ts"],
      diff: "+ expect(true).toBe(true)\n",
    });
    expect(r.type).toBe("test");
  });

  it("detects packages/* scope", () => {
    const r = classify({
      files: ["packages/commit-flow/src/classify.ts"],
      diff: "+ export function classify() {}\n implement new classifier\n",
    });
    expect(r.scope).toBe("commit-flow");
  });

  it("defaults to chore", () => {
    const r = classify({
      files: [".gitignore"],
      diff: "+ node_modules\n",
    });
    expect(r.type).toBe("chore");
  });

  it("flags breaking change markers", () => {
    const r = classify({
      files: ["src/api.ts"],
      diff: "+ BREAKING CHANGE: remove legacy endpoint\n",
    });
    expect(r.isBreaking).toBe(true);
  });

  it("classifies test even when diff contains fix keywords", () => {
    const r = classify({
      files: ["src/foo.test.ts"],
      diff: "+ expect(fn).toBe(undefined) // fix later\n",
    });
    expect(r.type).toBe("test");
  });

  it("classifies docs even when diff contains feat keywords", () => {
    const r = classify({
      files: ["README.md"],
      diff: "+ add new feature documentation\n",
    });
    expect(r.type).toBe("docs");
  });

  it("does not trigger fix from keywords in removed lines", () => {
    const r = classify({
      files: ["src/api.ts"],
      diff: "-const brokenHandler = () => {}\n+const handler = () => {}\n",
    });
    expect(r.type).not.toBe("fix");
  });
});
