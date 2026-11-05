export function retainUnchangedFields<T>(previous: T | null, next: T): T {
  if (previous === null) return next;
  if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object" ||
    Array.isArray(next)
  )
    return next;
  const shared = { ...next } as Record<string, unknown>;
  const old = previous as Record<string, unknown>;
  for (const key of Object.keys(shared)) {
    if (
      Object.hasOwn(old, key) &&
      JSON.stringify(old[key]) === JSON.stringify(shared[key])
    )
      shared[key] = old[key];
  }
  return shared as T;
}
