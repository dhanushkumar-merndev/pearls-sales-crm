export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
export const SEARCH_DEBOUNCE_MS = 500;

export function searchDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function containsSearchPattern(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\%_*,():"']/g, " ")
    .replace(/\s+/g, "%");
  return `%${normalized}%`;
}

export function prefixSearchPattern(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\%_*,():"']/g, " ")
    .replace(/\s+/g, "%");
  return `${normalized}%`;
}
