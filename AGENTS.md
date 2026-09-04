# Open-Magiviz — Agent 工作约定

- 本项目的制作经验库位于 `.agents/skills/magiviz-playbook/`（SKILL.md + references/）。
  - 干活前：涉及部署、CI、供应商接入、计费定价、R2 存储、Trigger 合成、文案/界面修改时，先按主题读对应 references 的经验条目。
  - **干活后：每次完成较大改动（feature、部署、事故修复、有价值的失败尝试），必须执行该 skill 的「沉淀模式」流程，把新经验写回对应文件后再收尾。** typo 级小改动可跳过。
- 运维 runbook 以仓库根的 `DEPLOY-CHECKLIST.md` 为准；经验库只链接它，不复制。
- 代码质量检查流程以仓库根的 `QUALITY-CHECKLIST.md` 为准；提交前跑 `npm run check`（typecheck + lint + 单测），UI/文案改动另过 GUI 回归矩阵。

## Agent skills

### Issue tracker

工单以本地 Markdown 存放于 `.scratch/<feature>/`（公开 fork，工单不推送；`.scratch/` 已 gitignore）。See `docs/agents/issue-tracker.md`.

### Triage labels

默认五角色词汇：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。See `docs/agents/triage-labels.md`.

### Domain docs

单上下文布局：根 `CONTEXT.md` 领域词汇表 + `docs/adr/`。See `docs/agents/domain.md`.
