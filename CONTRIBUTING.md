# 贡献指南

## 环境

- Node.js ≥ 20.19（CI 使用 Node 22）
- npm（仓库用 npm workspaces，提交的 `package-lock.json` 必须与 workspace 同步）

## 本地开发与门禁

```bash
npm install
npm run dev            # http://localhost:5173

# 提交前建议全跑一遍（和 CI 基本一致）
npm run ci:lock        # 锁文件与 workspace 一致性
npm run typecheck
npm test               # vitest（当前 500+ 用例）
npm run ci:build       # build:all（站点 + 单文件离线版） + 体积预算
npm run check:games    # 20 个机位清单 + 每款游戏独立 chunk
```

线上验证、部署、回滚见 [docs/DEPLOYMENT.md](DEPLOYMENT.md)。

## workspace 与锁文件（最容易踩的坑）

新增/删除 `games/*`、`packages/*` 里的包之后，**必须重新生成锁文件**再提交：

```bash
# 1) 所有包都加完之后再执行
npm install

# 2) 确认锁文件确实有改动（新增 workspace 包时通常会有）
git status package-lock.json

# 3) 自检：锁文件里的 workspace 条目数应等于实际目录数
grep -c '^    "games/' package-lock.json
ls -d games/*/ | wc -l
```

CI 的 `Lockfile sync` 节点会跑 `npm install --package-lock-only` 并检查 `git diff`：
锁文件过期时会直接失败，并在日志/Step Summary 里打印差异和修复命令，不会再出现
「每个 job 都在 `npm ci` 处报 EUSAGE」的连锁失败。

## 分支与 PR

- 小改动、文档改动：可以直接提交到 `master`（仓库管理员可绕过分支保护）。
- 新增游戏、改流水线、改依赖、涉及多个模块的改动：**开分支 → 提 PR → CI 绿了再合**。
  - PR 会跑完整 CI（`CI gate` 是 `master` 的必需检查），但**不会触发部署**；
  - 部署只在 `master` 上 CI 成功后由 `workflow_run` 触发。
- 分支命名参考：`feat/xxx`、`fix/xxx`、`ci/xxx`、`docs/xxx`。

## 提交信息

建议使用 Conventional Commits 前缀：`feat:`、`fix:`、`docs:`、`ci:`、`chore:`、`refactor:`。
一次性交付多个模块时，在正文里列清楚改了什么、验证了什么。

## 新增一款游戏

1. 在 `games/<id>/` 下创建 `package.json`（`@arcade/game-<id>`）、`src/meta.ts`、`src/index.ts`，可选 `src/logic.ts` / `src/art.ts` / `test/<id>.test.ts`；
2. 在 `packages/registry/slots.json` 里登记机位（`id` 与 `no` 必须和 meta 对应）；
3. 跑 `npm install` 更新锁文件（workspace 包）；
4. 本地跑通 `npm run check:games`、`npm test`、`npm run ci:build`、`npm run ci:smoke`；
5. 首页卡片 / 播放壳由 `import.meta.glob` 自动发现，无需手工登记。

## 新增/修改游戏逻辑的约定

- 纯逻辑放在 `logic.ts`，与渲染分离，便于单测；
- 规格文档在 `docs/game-specs*.md`，实现偏离规格时要在代码注释里说明原因，并用测试钉住；
- 所有源码文件必须是合法 UTF-8（CI 不校验，但损坏的中文注释不易发现）。
