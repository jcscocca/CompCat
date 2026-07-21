export const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

export function categoryLabel(value: string, layer: "reported" | "arrests" | "calls" = "reported"): string {
  if (!value) return layer === "arrests" ? "All arrests" : layer === "calls" ? "All calls" : "All reported";
  return CATEGORIES.find((c) => c.value === value)?.label ?? (layer === "arrests" ? "All arrests" : "All reported");
}
