// Form styling for the request flow, taken from the shared design system (src/components/ui).
import { buttonClass } from "@/components/ui/button";

export { errorTextClass as errorText, inputClass as fieldClass, labelClass } from "@/components/ui/field";
export const primaryButton = buttonClass({ size: "lg", full: true });
export const secondaryButton = buttonClass({ variant: "secondary" });
