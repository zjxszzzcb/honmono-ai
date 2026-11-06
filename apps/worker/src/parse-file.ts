import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, customerServices, getOrCreateConversation, getSkillVersion, appendMessage, uploads } from "@honmono/db";
import * as storage from "@honmono/storage";

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export async function parseUpload(uploadId: string): Promise<void> {
  const [up] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
  if (!up || up.parseStatus !== "pending") return;
  const [service] = await db.select().from(customerServices).where(eq(customerServices.id, up.serviceId)).limit(1);
  if (!service) return;
  const draftVersionId = service.draftSkillVersionId;
  const draft = draftVersionId ? await getSkillVersion(draftVersionId) : null;
  if (!draft) {
    await db.update(uploads).set({ parseStatus: "failed", parseReport: { reason: "草稿不存在" } }).where(eq(uploads.id, up.id));
    return;
  }

  await db.update(uploads).set({ parseStatus: "parsing" }).where(eq(uploads.id, up.id));

  const ext = path.extname(up.originalName).toLowerCase();
  const buf = await storage.readBinary(up.storedPath);
  let status = "failed";
  let report: Record<string, unknown> = {};
  let textContent: string | null = null;

  try {
    if (TEXT_EXT.has(ext)) {
      textContent = buf.toString("utf8");
      status = "parsed";
      report = { chars: textContent.length, note: "文本文件直接规范化" };
    } else if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: buf });
      textContent = res.value;
      status = textContent.trim() ? "parsed" : "failed";
      report = { chars: textContent.length };
    } else if (ext === ".pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      textContent = Array.isArray(text) ? text.join("\n\n") : text;
      const total = totalPages as number;
      const chars = textContent.length;
      status = chars > 20 ? (chars / Math.max(total, 1) > 40 ? "parsed" : "partial") : "failed";
      report = { pages: total, chars, note: chars > 20 ? "文本层已提取；若为扫描件则信息有限" : "疑似扫描件，无文本层" };
    } else if (ext === ".xlsx" || ext === ".xls") {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((ws) => {
        parts.push(`## 工作表：${ws.name}`);
        ws.eachRow((row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            cells.push(v == null ? "" : typeof v === "object" && "text" in (v as object) ? String((v as { text: string }).text) : String(v));
          });
          parts.push(cells.join(" | "));
        });
      });
      textContent = parts.join("\n");
      status = textContent.trim() ? "parsed" : "failed";
      report = { sheets: wb.worksheets.length, chars: textContent.length };
    } else if (IMAGE_EXT.has(ext)) {
      status = "unsupported";
      report = { note: "图片不做 OCR；若运行时模型支持多模态可读取原件，否则需要文字补充", bytes: buf.length };
    } else {
      status = "unsupported";
      report = { note: `暂不支持的文件类型: ${ext || "未知"}` };
    }
  } catch (err) {
    status = "failed";
    report = { reason: err instanceof Error ? err.message : String(err) };
  }

  let textPath: string | null = null;
  if (textContent && textContent.trim()) {
    textPath = `${draft.rootPath}/references/source-${up.id}.md`;
    const header = `# 来源文件：${up.originalName}\n\n> 由服务端自动解析生成；上传时间 ${new Date().toISOString()}；解析状态 ${status}。\n\n`;
    await storage.writeText(textPath, header + textContent);
  }

  await db
    .update(uploads)
    .set({ parseStatus: status, parseReport: report, textPath, draftVersionId: draft.id })
    .where(eq(uploads.id, up.id));

  // 更新草稿 source-index.md
  try {
    const indexPath = `${draft.rootPath}/references/source-index.md`;
    let indexText = await storage.exists(indexPath)
      ? await storage.readText(indexPath)
      : "# 来源索引\n\n| uploadId | 文件名 | 状态 | 文本副本 | 摘要 |\n| --- | --- | --- | --- | --- |\n";
    if (!indexText.includes("| uploadId |")) {
      indexText += "\n| uploadId | 文件名 | 状态 | 文本副本 | 摘要 |\n| --- | --- | --- | --- | --- |\n";
    }
    const summary = status === "parsed" ? `已文本化（${report.chars ?? "?"} 字符）` : status === "partial" ? "部分解析" : status === "unsupported" ? String(report.note ?? "不支持") : `解析失败：${report.reason ?? report.note ?? "?"}`;
    indexText += `| ${up.id} | ${up.originalName} | ${status} | ${textPath ? `references/source-${up.id}.md` : "—"} | ${summary} |\n`;
    await storage.writeText(indexPath, indexText);
  } catch {
    // 索引更新失败不阻塞
  }

  // 通知配置会话（以系统消息进入下轮 Agent 上下文）
  const conv = await getOrCreateConversation(service.id, "config", null);
  await appendMessage({
    conversationId: conv.id,
    serviceId: service.id,
    role: "system",
    authorType: "system",
    content:
      status === "parsed"
        ? `商户上传了文件《${up.originalName}》，已解析完成并写入 references/source-${up.id}.md（${report.chars ?? "?"} 字符）。请在下一轮归纳其内容。`
        : status === "partial"
          ? `商户上传了文件《${up.originalName}》，仅部分内容可解析（${String(report.note ?? "")}）。`
          : `商户上传了文件《${up.originalName}》，但无法解析（${String(report.note ?? report.reason ?? "")}）。如该文件重要，请商户粘贴关键内容。`,
  });
}

export async function _unusedFs() {
  await fs.readdir(".");
}
