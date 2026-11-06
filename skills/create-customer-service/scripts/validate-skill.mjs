// 确定性 Skill 结构校验。由服务端以固定参数调用（validate_skill 工具内部），Agent 不能传任意命令。
// 用法: import { validateSkillDir } from './validate-skill.mjs'; validateSkillDir(dir)
// 或 CLI: node validate-skill.mjs <skillDir>  （退出码 0=通过 1=不通过）
import { promises as fs } from "node:fs";
import path from "node:path";

const REQUIRED_REFERENCES = ["company.md", "products.md", "conversation-rules.md"];

export async function validateSkillDir(dir) {
  const blockers = [];
  const warnings = [];
  const readiness = { p0: {}, p1: {}, p2: {} };

  // 1. SKILL.md 存在且结构有效
  let skillText;
  try {
    skillText = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return { ok: false, readiness, warnings, blockers: ["缺少 SKILL.md"] };
  }
  const fm = parseFrontmatter(skillText);
  if (!fm.name || !fm.description) blockers.push("SKILL.md 缺少 frontmatter name/description");

  const section = (titleRe) => {
    const re = new RegExp(`^#{1,3}\\s*.*${titleRe}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`, "m");
    const m = skillText.match(re);
    return m ? m[1].trim() : "";
  };

  const role = section("角色与身份");
  const biz = section("业务与产品");
  const scope = section("服务范围与边界");
  const templatePlaceholder = "unknown（待确认";
  readiness.p0.identity = role && !role.includes(templatePlaceholder) ? "confirmed" : role ? "unknown" : "missing";
  readiness.p0.business = biz && !biz.includes(templatePlaceholder) ? "confirmed" : biz ? "unknown" : "missing";
  readiness.p0.scope = scope && !scope.includes(templatePlaceholder) ? "confirmed" : scope ? "unknown" : "missing";
  if (!role || role.includes(templatePlaceholder)) blockers.push("「角色与身份」尚未确认（仍是模板占位或为空）");
  if (!biz || biz.includes(templatePlaceholder)) blockers.push("「业务与产品」尚未确认（仍是模板占位或为空）");
  if (!scope || scope.includes(templatePlaceholder)) blockers.push("「服务范围与边界」尚未确认（仍是模板占位或为空）");

  // 2. 必需 references 存在且非空
  for (const f of REQUIRED_REFERENCES) {
    try {
      const text = (await fs.readFile(path.join(dir, "references", f), "utf8")).trim();
      if (!text) blockers.push(`references/${f} 为空文件`);
      if (f === "conversation-rules.md" && text) {
        const hasFallback = /转人工|人工兜底|ask_human|人工客服|联系.{0,6}(客服|人工)/.test(text);
        readiness.p0.fallback = hasFallback ? "confirmed" : "missing";
        if (!hasFallback) blockers.push("references/conversation-rules.md 缺少人工兜底规则");
      }
    } catch {
      blockers.push(`缺少 references/${f}`);
    }
  }

  // 3. 资源索引指向的文件必须存在（防死链）
  const indexRefs = [...skillText.matchAll(/references\/([a-zA-Z0-9._-]+\.md)/g)].map((m) => m[1]);
  for (const ref of new Set(indexRefs)) {
    try {
      await fs.access(path.join(dir, "references", ref));
    } catch {
      blockers.push(`SKILL.md 资源索引指向不存在的文件: references/${ref}`);
    }
  }

  // 4. SKILL.md 精炼度（软约束）
  const lineCount = skillText.split("\n").length;
  if (lineCount > 120) warnings.push(`SKILL.md 超过 120 行（${lineCount}），建议精炼并把细节移到 references`);

  // 5. 空文件检查
  const files = await listFilesRecursive(dir);
  for (const f of files) {
    if (f.endsWith(".md")) {
      const st = await fs.stat(path.join(dir, f));
      if (st.size === 0) blockers.push(`空文件: ${f}`);
    }
  }

  const ok = blockers.length === 0;
  return { ok, readiness, warnings, blockers };
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) out[kv[1].trim()] = kv[2].trim();
  }
  return out;
}

async function listFilesRecursive(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFilesRecursive(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith("validate-skill.mjs")) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("用法: node validate-skill.mjs <skillDir>");
    process.exit(2);
  }
  const res = await validateSkillDir(dir);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
