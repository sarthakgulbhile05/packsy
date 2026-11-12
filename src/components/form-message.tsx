import { Alert } from "@/components/ui/alert";

/**
 * A form's result: error (red, interrupts screen readers), success (green) or neutral notice (blue).
 * Only one is shown, in that order.
 */
export function FormMessage({ error, success, notice }: { error?: string; success?: string; notice?: string }) {
  if (error) return <Alert tone="error">{error}</Alert>;
  if (success) return <Alert tone="success">{success}</Alert>;
  if (notice) return <Alert tone="info">{notice}</Alert>;
  return null;
}
