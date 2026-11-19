/**
 * 运维告警（GitHub Issue）：失败时创建/更新 issue，恢复时自动关闭。
 *
 * 环境变量：
 *   GH_TOKEN      必填，Actions 里传 secrets.GITHUB_TOKEN（需要 issues: write）
 *   GITHUB_REPOSITORY  owner/repo（Actions 自动注入）
 *   ALERT_TITLE   告警标题；按这个标题去重（必须是固定文案）
 *   ALERT_MODE    open（默认）| close
 *   ALERT_BODY    失败详情（可选，open 时写入 issue 正文/评论）
 *   RUN_URL       本次 Actions 运行链接（可选）
 *   NEEDS_JSON    各节点结果（可选，来自 toJSON(needs)）
 *   REF_NAME      分支/ref（可选）
 *
 * 设计：只依赖 GitHub REST + 内置 fetch，不需要第三方依赖；任何 API 失败都只打日志退出 0，
 * 不掩盖原本的失败结果，也不会让告警流程本身变成新的故障点。
 */
import { appendFileSync } from "node:fs";

const token = process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const title = process.env.ALERT_TITLE ?? "CI/CD 告警";
const mode = process.env.ALERT_MODE ?? "open";
const runUrl = process.env.RUN_URL ?? "";
const refName = process.env.REF_NAME ?? "";
const needs = process.env.NEEDS_JSON ?? "{}";

if (!token || !repo) {
  console.error("缺少 GH_TOKEN 或 GITHUB_REPOSITORY，跳过告警");
  process.exit(0);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pixel-arcade-ci",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
};

const summary = (lines) => {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
};

const needsTable = (() => {
  try {
    const parsed = JSON.parse(needs);
    const rows = Object.entries(parsed).map(([name, value]) => `| \`${name}\` | ${value.result} |`);
    return rows.length ? ["", "| 节点 | 结果 |", "| --- | --- |", ...rows].join("\n") : "";
  } catch {
    return "";
  }
})();

const body = [
  `## ${title}`,
  "",
  `- 时间：${new Date().toISOString()}`,
  refName ? `- Ref：\`${refName}\`` : "",
  runUrl ? `- 运行记录：${runUrl}` : "",
  needsTable,
  process.env.ALERT_BODY ? `\n${process.env.ALERT_BODY}` : "",
  "",
  "> 该 issue 由 GitHub Actions 自动维护：处理完成后重新运行成功的流水线会自动关闭。",
]
  .filter(Boolean)
  .join("\n");

async function findOpenIssue() {
  const res = await api(`/repos/${repo}/issues?state=open&per_page=100`);
  if (!res.ok) throw new Error(`查询 issue 失败：HTTP ${res.status} ${JSON.stringify(res.body)}`);
  return (Array.isArray(res.body) ? res.body : []).find((issue) => issue.title === title) ?? null;
}

try {
  const existing = await findOpenIssue();

  if (mode === "close") {
    if (!existing) {
      summary([`## 运维告警`, "", `无未关闭的「${title}」issue，无需操作。`]);
    } else {
      await api(`/repos/${repo}/issues/${existing.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `流水线恢复正常，自动关闭告警。${runUrl ? `\n\n运行记录：${runUrl}` : ""}` }),
      });
      await api(`/repos/${repo}/issues/${existing.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
      summary([`## 运维告警`, "", `已自动关闭 issue #${existing.number}（恢复）。`]);
    }
    process.exit(0);
  }

  if (existing) {
    await api(`/repos/${repo}/issues/${existing.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    summary([`## 运维告警`, "", `已更新已有 issue #${existing.number}（${title}）。`]);
  } else {
    const created = await api(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
    if (!created.ok) throw new Error(`创建 issue 失败：HTTP ${created.status} ${JSON.stringify(created.body)}`);
    summary([`## 运维告警`, "", `已创建 issue #${created.body.number}（${title}）。`]);
  }
} catch (error) {
  // 告警失败不能掩盖原始失败，只记录
  console.error(`告警流程失败（不影响主流程结果）：${error?.message ?? error}`);
  summary([`## 运维告警`, "", `告警创建失败：${error?.message ?? error}`]);
}

process.exit(0);
