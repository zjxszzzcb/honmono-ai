export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="honmono-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8A00" />
          <stop offset="1" stopColor="#FF4D00" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#honmono-g)" />
      <path
        d="M21 20.5h22a7 7 0 0 1 7 7v9a7 7 0 0 1-7 7H31.5l-8.2 7.4a1.4 1.4 0 0 1-2.3-1.05V43.2A7 7 0 0 1 14 36.5v-9a7 7 0 0 1 7-7z"
        fill="#fff"
      />
      <path
        d="M25.5 32.4l5.4 5.4 9.6-11.2"
        stroke="url(#honmono-g)"
        strokeWidth="4.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="49.5" cy="16" r="3.4" fill="#FFE0CC" />
    </svg>
  );
}

export function Logo({ size = 30, light = false }: { size?: number; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark size={size} />
      <span className={`font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`} style={{ fontSize: size * 0.62 }}>
        Honmono <span className="text-[#FF5000]">AI</span>
      </span>
    </span>
  );
}
