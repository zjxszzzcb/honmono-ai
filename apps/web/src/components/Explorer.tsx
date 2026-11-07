import { useEffect, useMemo, useState } from "react";
import { api } from "../auth";

export type TreeNode = { path: string; dir: boolean };

type Node = { name: string; path: string; children: Map<string, Node>; isDir: boolean };

export function buildTree(paths: TreeNode[]) {
  const root: Node = { name: "", path: "", children: new Map(), isDir: true };
  for (const p of paths) {
    const parts = p.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (!cur.children.has(part)) {
        cur.children.set(part, { name: part, path, children: new Map(), isDir: isLast ? p.dir : true });
      }
      cur = cur.children.get(part)!;
    });
  }
  return root;
}

const ORDER = ["SKILL.md", "references", "assets"];

function sortNodes(nodes: Node[]): Node[] {
  return [...nodes].sort((a, b) => {
    const ai = ORDER.indexOf(a.name);
    const bi = ORDER.indexOf(b.name);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function countChildren(n: { children: Map<string, Node> }): number {
  let count = 0;
  for (const [, child] of n.children) {
    count += child.isDir ? countChildren(child) : 1;
  }
  return count;
}

function fileIcon(path: string): string {
  if (path.endsWith("SKILL.md")) return "📘";
  if (path.startsWith("assets/raw/")) return "📎";
  if (path.startsWith("references/source-")) return "📄";
  if (path.startsWith("_guides/")) return "🧭";
  if (path.endsWith(".md")) return "📝";
  return "📄";
}

export function Explorer({
  serviceId,
  refreshKey,
  activePath,
  onOpen,
  onUpload,
  uploading,
}: {
  serviceId: string;
  refreshKey: number;
  activePath: string | null;
  onOpen: (path: string) => void;
  onUpload: (files: FileList) => void;
  uploading: boolean;
}) {
  const [tree, setTree] = useState<{ root: string; files: TreeNode[] } | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api<{ root: string; files: TreeNode[] }>(`/api/customer-services/${serviceId}/files/tree`)
      .then((t) => {
        if (!alive) return;
        setTree(t);
        // 默认所有目录折叠，只露出根文件（SKILL.md 等）
        setCollapsed((prev) => {
          if (prev.size > 0) return prev;
          const dirs = t.files.filter((f) => f.dir).map((f) => f.path.replace(/\/$/, ""));
          return new Set(dirs);
        });
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [serviceId, refreshKey]);

  const root = useMemo(() => buildTree((tree?.files ?? []).filter((f) => !f.dir)), [tree]);

  const renderNodes = (nodes: ReturnType<typeof buildTree>["children"], depth: number): React.ReactNode => {
    return sortNodes([...nodes.values()]).map((n) => {
      if (n.isDir && n.children.size > 0) {
        const isCollapsed = collapsed.has(n.path);
        return (
          <div key={n.path}>
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left hover:bg-slate-100"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(n.path)) next.delete(n.path);
                  else next.add(n.path);
                  return next;
                })
              }
            >
              <svg
                className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span className="truncate text-[13px] font-medium text-slate-600">{n.name}</span>
              <span className="ml-auto text-[10px] text-slate-300">{countChildren(n)}</span>
            </button>
            {!isCollapsed && renderNodes(n.children, depth + 1)}
          </div>
        );
      }
      if (n.isDir) return null;
      const active = activePath === n.path;
      return (
        <button
          key={n.path}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left ${
            active ? "bg-orange-50 text-[#c2410c]" : "hover:bg-slate-100 text-slate-600"
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onOpen(n.path)}
          title={n.path}
        >
          <span className="shrink-0 text-[12px]">{fileIcon(n.path)}</span>
          <span className="truncate text-[13px]">{n.name}</span>
        </button>
      );
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">资源管理器</span>
        <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100" title="上传原始文件（将存入 assets/raw/）">
          {uploading ? "…" : "＋ 上传"}
          <input
            type="file"
            multiple
            className="hidden"
            accept=".md,.txt,.csv,.json,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {error && <p className="px-2 text-xs text-red-500">{error}</p>}
        {!tree && !error && <p className="px-2 text-xs text-slate-400">加载中…</p>}
        {tree && tree.files.filter((f) => !f.dir).length === 0 && (
          <p className="px-2 text-xs leading-relaxed text-slate-400">工作目录为空。上传资料或在右侧对话，文件会出现在这里。</p>
        )}
        {renderNodes(root.children, 0)}
      </div>
      <div className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400">
        {tree?.root ?? "drafts"} · 点击文件编辑
      </div>
    </div>
  );
}
