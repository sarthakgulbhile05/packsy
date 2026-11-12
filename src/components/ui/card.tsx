/** The standard white surface: rounded, hairline border, generous padding. */
export function Card({ as: Tag = "div", className = "", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return <Tag className={`rounded-card border border-line bg-white p-5 shadow-card sm:p-6 ${className}`} {...props} />;
}
