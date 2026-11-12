/** Structured data for search engines and AI answers. Only describe what the visible page says. */
export function JsonLd({ data }: { data: object }) {
  // Escape "<" so no string in the data can close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
