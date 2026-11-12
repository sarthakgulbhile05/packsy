/** What to show when a list or page has nothing yet: a short title, one line of help, one next step. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white px-5 py-10 text-center sm:px-8">
      <p className="font-semibold text-navy">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
