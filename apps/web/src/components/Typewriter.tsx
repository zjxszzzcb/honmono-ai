import { useEffect, useRef, useState } from "react";

/**
 * 打字机效果：让展示文本逐步追上目标文本。
 * 目标文本增长时继续追；缩短（重置）时从头开始。
 */
export function useTypewriter(target: string, enabled: boolean, options?: { charsPerTick?: number; intervalMs?: number }) {
  const { charsPerTick, intervalMs = 22 } = options ?? {};
  const [shown, setShown] = useState(() => (enabled ? "" : target));
  const shownLenRef = useRef(enabled ? 0 : target.length);
  const targetRef = useRef(target);

  useEffect(() => {
    if (!enabled) {
      shownLenRef.current = target.length;
      setShown(target);
      targetRef.current = target;
      return;
    }
    // 目标被整体替换（变短）→ 重置
    if (target.length < shownLenRef.current) {
      shownLenRef.current = 0;
    }
    targetRef.current = target;
    const perTick = charsPerTick ?? Math.max(2, Math.ceil(target.length / 70));
    const timer = setInterval(() => {
      if (shownLenRef.current >= targetRef.current.length) {
        setShown(targetRef.current);
        return;
      }
      shownLenRef.current = Math.min(targetRef.current.length, shownLenRef.current + perTick);
      setShown(targetRef.current.slice(0, shownLenRef.current));
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled]);

  return shown;
}

/** 带光标动画的文本展示 */
export function TypewriterText({ text, enabled, className }: { text: string; enabled: boolean; className?: string }) {
  const shown = useTypewriter(text, enabled);
  const done = shown.length >= text.length;
  return (
    <span className={className}>
      {shown}
      {!done && <span className="typewriter-caret" aria-hidden="true" />}
    </span>
  );
}
