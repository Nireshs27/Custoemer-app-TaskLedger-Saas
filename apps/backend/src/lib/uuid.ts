// Lightweight UUID v4-style validator (case-insensitive). Accepts standard 8-4-4-4-12 format.
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value);
}

