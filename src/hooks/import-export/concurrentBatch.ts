/**
 * Runs an async worker over `items` with a bounded concurrency window.
 * - Never aborts on a single failure: rejections are captured per-item and
 *   returned alongside successes so the caller can continue accumulating
 *   error rows into a ProcessingResult.
 * - Preserves input order in the returned array.
 * - Calls `onSettled` after each item completes (regardless of outcome) so
 *   the import UI can update progress per row, not per batch.
 */
export interface ConcurrentOptions {
  concurrency?: number;
  onSettled?: () => void;
}

export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export async function runWithConcurrency<TIn, TOut>(
  items: TIn[],
  worker: (item: TIn, index: number) => Promise<TOut>,
  opts: ConcurrentOptions = {}
): Promise<Settled<TOut>[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const results: Settled<TOut>[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value };
      } catch (err: any) {
        results[i] = {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      } finally {
        opts.onSettled?.();
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run()
  );
  await Promise.all(workers);
  return results;
}
