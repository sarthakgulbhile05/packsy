/** Small inline spinner; inherits the text colour. Hidden from screen readers (pair it with text). */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none ${className}`}
    />
  );
}

/** Grey placeholder block while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-control bg-line motion-reduce:animate-none ${className}`} />;
}
