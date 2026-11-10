/** A static flourish with no image request, filters or animation work. */
export function WaveRule({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 288 16" preserveAspectRatio="none" className={`text-fg-2 h-3 w-full ${className}`} aria-hidden="true" focusable="false">
      <path
        d={`M0 8 Q6 1 12 8 ${Array.from({ length: 23 }, (_, index) => `T${(index + 2) * 12} 8`).join(" ")}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
