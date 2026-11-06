import { useEffect, useState } from "react";
import { api } from "../auth";

export type TreeNode = { path: string; dir: boolean };

const GUIDE_RE = /^_guides\//;

function fileIcon(path: string): string {
  if (path.endsWith("SKILL.md")) return "📘";
  if (path.startsWith("references/source-")) return "📄";
  if (path.startsWith("_guides/")) return "🧭";
  if (path.includes("assets/")) return "🗂️";
  if (path.endsWith(".md")) return "📝";
  return "📄";
}

/** 技能工作目录树：分组展示 + 点击预览内容 */
export function FileTree({ serviceId, refreshKey }: { serviceId: string; refreshKey: number }) {
  const [tree, setTree] = useState<{ root: string; files: TreeNode[] } | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ root: string; files: TreeNode[] }>(`/api/customer-services/${serviceId}/files/tree`)
      .then((t) => {
        if (alive) setTree(t);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [serviceId, refreshKey]);

  const openPreview = async (path: string) => {
    try {
      const p = await api<{ path: string; content: string }>(
        `/api/customer-services/${serviceId}/files/preview?path=${encodeURIComponent(path)}`,
      );
      setPreview(p);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    }
  };

  const guides = (tree?.files ?? []).filter((f) => !f.dir && GUIDE_RE.test(f.path));
  const skill = (tree?.files ?? []).filter((f) => !f.dir && !GUIDE_RE.test(f.path));

  return (
    <div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!tree && !error && <p className="text-xs text-slate-400">加载中…</p>}
      {tree && skill.length === 0 && <p className="text-xs text-slate-400">工作目录还是空的，发消息后这里会实时生成文件</p>}
      {tree && skill.length > 0 && (
        <ul className="space-y-0.5 text-[13px]">
          {skill.map((f) => (
            <li key={f.path}>
              <button
                className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-orange-50"
                onClick={() => openPreview(f.path)}
              >
                <span className="shrink-0 text-[13px]">{fileIcon(f.path)}</span>
                <span className="truncate font-mono text-xs text-slate-600 group-hover:text-[#FF5000]" title={f.path}>
                  {f.path}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tree && guides.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50">
            🧭 配置指南（{guides.length} 份，仅供配置参考）
          </summary>
          <ul className="mt-1 space-y-0.5">
            {guides.map((f) => (
              <li key={f.path}>
                <button
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                  onClick={() => openPreview(f.path)}
                >
                  <span className="truncate font-mono text-xs text-slate-500" title={f.path}>
                    {f.path.replace("_guides/", "")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-orange-50 px-2 py-0.5 font-mono text-xs text-[#FF5000]">{tree?.root}</span>
                <span className="font-mono text-sm text-slate-700">{preview.path}</span>
              </div>
              <button className="rounded-lg px-2.5 py-1 text-slate-400 hover:bg-slate-100" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <pre className="flex-1 overflow-auto bg-slate-50 p-5 text-[12.5px] leading-relaxed text-slate-700 whitespace-pre-wrap">
              {preview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
