# commit-flow E2E

## 安装

- [ ] `/plugin install commit-flow@claude-plugins` 后可见全部 slash
- [ ] `npm i -g claude-commit-flow` → `commit-flow --version` ≥ 0.2.0

## CLI

- [ ] `classify --json` 含 `suggestedBranch`
- [ ] `suggest-branch` 输出合理 `type/slug`
- [ ] 暂存 `.env` 时拒绝

## 对话（对齐 Cursor）

- [ ] `/create-branch` 创建分支
- [ ] `/branch-commit` 建分支并 commit（含 Impact）
- [ ] `/branch-commit-push` 确认前不 push；确认后 `-u`
- [ ] `/commit` / `/commit-push` / `/push` 行为同 v0.1
- [ ] `/commit-pr`：无 `gh` 时友好失败；有则确认后给出 PR URL
- [ ] 未确认时不得自行 push / `gh pr create`
