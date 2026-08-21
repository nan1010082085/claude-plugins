/**
 * 集成测试：临时 git 仓库 stage 后跑 classify。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { classify } from "../src/classify.js";
import { stagedDiff, stagedFiles, stagedNumstat } from "../src/git.js";
import { parseNumstat } from "../src/message.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/**
 * 初始化临时 git 仓库并返回 cwd。
 */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "commit-flow-"));
  dirs.push(dir);
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

describe("git integration", () => {
  it("reads staged files and classifies", () => {
    const cwd = initRepo();
    writeFileSync(join(cwd, "hello.ts"), "export const x = 1;\n");
    execFileSync("git", ["add", "hello.ts"], { cwd });

    const files = stagedFiles({ cwd });
    expect(files).toEqual(["hello.ts"]);
    const diff = stagedDiff({ cwd });
    const stats = parseNumstat(stagedNumstat({ cwd }));
    const c = classify({
      files,
      diff,
      branch: "feat/demo",
    });
    expect(c.type === "feat" || c.type === "chore").toBe(true);
    expect(stats.files).toBe(1);
    expect(stats.added).toBeGreaterThan(0);
  });
});
