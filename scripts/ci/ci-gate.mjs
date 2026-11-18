/**
 * CI 门禁：汇总各节点结果。failure / cancelled 一律失败；skipped 允许
 * （文档类改动会跳过代码节点，属于预期行为）。
 */
import { appendFileSync } from "node:fs";

const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
const entries = Object.entries(needs);

const lines = ["## CI 节点结果", "", "| 节点 | 结果 |", "| --- | --- |"];
for (const [name, result] of entries) {
  lines.push(`| \`${name}\` | ${result.result} |`);
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

const failed = entries.filter(([, value]) => ["failure", "cancelled"].includes(value.result));
if (failed.length) {
  console.error(`\nCI 未通过：${failed.map(([name, value]) => `${name}=${value.result}`).join(", ")}`);
  process.exit(1);
}
console.log("\n✅ 必需节点全部通过");
