export const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? "All reported";
}
