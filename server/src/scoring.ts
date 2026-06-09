export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function matchesAnswer(value: string, expected: string, aliases: string[] = []): boolean {
  const normalized = normalizeAnswer(value);
  return [expected, ...aliases].some((candidate) => normalizeAnswer(candidate) === normalized);
}
