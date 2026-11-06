import { useRef, useState, type ReactNode } from "react";

/**
 * Kimi 风格输入框：圆角容器、底部左侧附加按钮、右侧圆形发送键。
 * Enter 发送（IME 组合中不触发）、Shift+Enter 换行。
 */
export function Composer({
  placeholder,
  disabled,
  onSend,
  attach,
  attachLabel = "上传",
  sendLabel,
  emptyHint,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
  attach?: { onFiles: (files: FileList) => void; accept?: string };
  attachLabel?: string;
  sendLabel?: string;
  emptyHint?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || disabled || busyRef.current) return;
    busyRef.current = true;
    try {
      await onSend(content);
      setText("");
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="composer">
      {emptyHint}
      <textarea
        ref={taRef}
        rows={1}
        className="composer-input"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow();
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !composing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bar">
        <div className="flex items-center gap-1.5">
          {attach && (
            <>
              <button
                type="button"
                className="composer-btn"
                title={attachLabel}
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                accept={attach.accept}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) attach.onFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="text-xs text-slate-400 hidden sm:inline">{attachLabel}</span>
            </>
          )}
        </div>
        {sendLabel && <span className="text-xs text-slate-400 hidden md:inline mr-1">{sendLabel}</span>}
        <button
          type="button"
          className={`composer-send ${text.trim() && !disabled ? "composer-send-active" : ""}`}
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
