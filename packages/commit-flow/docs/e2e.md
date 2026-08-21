# commit-flow E2E

## 插件安装

- [ ] `/plugin marketplace add nan1010082085/claude-plugins`（若未添加）
- [ ] `/plugin install commit-flow@claude-plugins`
- [ ] 重启或 reload 后可见 `/commit`、`/commit-push`、`/push`

## CLI

- [ ] `pnpm --filter commit-flow build && node packages/commit-flow/dist/index.js --version`
- [ ] 在有 staged 变更的仓库：`commit-flow classify --json` 含 `classification` / `template`
- [ ] 暂存 `.env` 时 classify 拒绝并退出非 0

## 对话流

- [ ] `/commit`：生成含 Why + Impact 的 message 并成功 commit
- [ ] `/commit-push`：commit 后询问确认，否定则不 push；肯定则 push
- [ ] `/push`：无新 commit，确认后 push；已同步时提示无需 push
- [ ] 未确认时 agent 不得自行 `git push`
