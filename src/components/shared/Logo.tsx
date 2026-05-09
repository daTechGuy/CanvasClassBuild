interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 32, showText = true, className }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="2" y="28" width="10" height="10" rx="2.5" fill="#e13f2a" />
        <rect x="15" y="17" width="10" height="10" rx="2.5" fill="#ee6c4d" />
        <rect x="28" y="6" width="10" height="10" rx="2.5" fill="#f59076" />
      </svg>
      {showText && (
        <span className="text-xl font-bold tracking-tight">
          <span className="text-violet-400">Canvas</span>
          <span className="text-slate-100">ClassBuild</span>
        </span>
      )}
    </div>
  );
}
