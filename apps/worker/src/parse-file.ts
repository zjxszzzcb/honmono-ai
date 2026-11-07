import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, customerServices, getOrCreateConversation, getSkillVersion, appendMessage, uploads } from "@honmono/db";
import * as storage from "@honmono/storage";

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const ZIP_EXTRACT_LIMITS = { maxMembers: 30, maxMemberBytes: 20 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 };

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

  if (ext === ".zip") {
    await parseZip(up, buf, draft);
    return;
  }

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

  // 原件进草稿 assets/raw/（工作台文件树可见；与 DB uploads 记录一一对应）
  try {
    const rawDir = `${draft.rootPath}/assets/raw`;
    const safeRawName = up.originalName.replace(/[\\/:*?"<>|]/g, "_");
    let rawRel = `${rawDir}/${safeRawName}`;
    let seq = 1;
    while (await storage.exists(rawRel)) {
      const dot = safeRawName.lastIndexOf(".");
      const stem = dot > 0 ? safeRawName.slice(0, dot) : safeRawName;
      const ext = dot > 0 ? safeRawName.slice(dot) : "";
      rawRel = `${rawDir}/${stem}-${seq}${ext}`;
      seq += 1;
    }
    await storage.copyFile(up.storedPath, rawRel);
  } catch {
    // 复制失败不影响解析结果
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

/** 资料包：解压 zip 并为每个受支持成员建上传任务（供"上传压缩包即可创建客服"） */
async function parseZip(
  up: { id: string; serviceId: string; originalName: string; storedPath: string },
  buf: Buffer,
  draft: { id: string; rootPath: string },
): Promise<void> {
  const ADMZip = (await import("adm-zip")).default;
  const { getQueue } = await import("./queues.js");
  const notes: string[] = [];
  let extracted = 0;
  let totalBytes = 0;
  try {
    const zip = new ADMZip(buf);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    for (const entry of entries) {
      const name = entry.entryName;
      if (name.includes("__MACOSX") || name.split("/").some((seg) => seg.startsWith("."))) continue;
      if (extracted >= ZIP_EXTRACT_LIMITS.maxMembers) {
        notes.push(`跳过 ${name}：成员数超过 ${ZIP_EXTRACT_LIMITS.maxMembers}`);
        continue;
      }
      const data = entry.getData();
      if (data.length > ZIP_EXTRACT_LIMITS.maxMemberBytes) {
        notes.push(`跳过 ${name}：单文件超过 20MB`);
        continue;
      }
      totalBytes += data.length;
      if (totalBytes > ZIP_EXTRACT_LIMITS.maxTotalBytes) {
        notes.push(`跳过 ${name}：累计解压超过 80MB`);
        continue;
      }
      const memberExt = path.extname(name).toLowerCase();
      if (memberExt === ".zip") {
        notes.push(`跳过 ${name}：不支持嵌套压缩包`);
        continue;
      }
      // 受支持的成员：写 incoming，建 uploads 行并入队解析
      const safeMember = name.split("/").pop()!.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
      const memberRel = `${path.dirname(up.storedPath)}/${up.id}-${extracted}-${safeMember}`;
      await storage.writeBinary(memberRel, data);
      const [member] = await db
        .insert(uploads)
        .values({
          serviceId: up.serviceId,
          originalName: safeMember,
          storedPath: memberRel,
          mime: null,
          size: data.length,
          sha256: storage.sha256OfBuffer(data),
          parseStatus: "pending",
        })
        .returning();
      await getQueue("files").add("parse", { uploadId: member.id }, { jobId: member.id, removeOnComplete: 100, removeOnFail: 200 });
      extracted += 1;
      notes.push(`已解包：${safeMember}（${(data.length / 1024).toFixed(1)} KB，解析中）`);
    }
  } catch (err) {
    notes.push(`解压失败：${err instanceof Error ? err.message : String(err)}`);
  }

  await db
    .update(uploads)
    .set({
      parseStatus: extracted > 0 ? "parsed" : "failed",
      parseReport: { note: `压缩包：解出 ${extracted} 个文件`, members: notes },
    })
    .where(eq(uploads.id, up.id));

  // 压缩包原件也进草稿 assets/raw/
  try {
    const [service] = await db.select().from(customerServices).where(eq(customerServices.id, up.serviceId)).limit(1);
    const dv = service?.draftSkillVersionId ? await getSkillVersion(service.draftSkillVersionId) : null;
    if (dv) {
      const rawRel = `${dv.rootPath}/assets/raw/${up.originalName}`;
      await storage.copyFile(up.storedPath, rawRel);
    }
  } catch {
    /* 忽略 */
  }

  const conv = await getOrCreateConversation(up.serviceId, "config", null);
  await appendMessage({
    conversationId: conv.id,
    serviceId: up.serviceId,
    role: "system",
    authorType: "system",
    content: `商户上传了资料包《${up.originalName}》：解出 ${extracted} 个文件进入解析队列。${notes.length ? "明细：" + notes.join("；") : ""}`,
  });
}
