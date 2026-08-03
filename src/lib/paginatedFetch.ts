/**
 * Fetch every row for a Supabase query in fixed-size pages, so callers don't
 * silently hit PostgREST's default max-rows cap (commonly 1000) on unbounded
 * `.select()` queries. Loops until either fewer than `pageSize` rows come back
 * or the safety cap `maxRows` is hit.
 *
 * `build` receives a fresh query and MUST re-apply its filters/ordering per
 * call — Supabase query builders are single-shot.
 *
 * Returns the concatenated rows plus a `truncated` flag so the UI can surface
 * "loaded N of many" instead of pretending the fetch was complete.
 */
export interface PaginatedResult<T> {
  rows: T[];
  truncated: boolean;
}

export async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<PaginatedResult<T>> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 50_000;
  const out: T[] = [];
  let from = 0;
  while (out.length < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) return { rows: out, truncated: false };
    from += pageSize;
  }
  return { rows: out.slice(0, maxRows), truncated: true };
}
