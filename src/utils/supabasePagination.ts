import { supabase } from '@/integrations/supabase/client';

type TableName = 'accounts' | 'contacts' | 'leads' | 'deals' | 'action_items';

interface PaginatedResult<T> {
  data: T[];
  totalCount: number;
}

interface PaginationOptions {
  page: number;
  pageSize: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  searchTerm?: string;
  searchFields?: string[];
  filters?: Record<string, string>;
  /**
   * When provided, restrict results to rows whose `id` is in this list.
   * An empty array returns no rows (used by the "In Deals" filter).
   */
  idIn?: string[];
}

/**
 * Fetch a single page of data with server-side pagination, sorting, search and filters.
 * Uses Supabase `.range()` and `{ count: 'exact' }` to return only the rows for the
 * current page plus the total matching count.
 */
export async function fetchPaginatedData<T = any>(
  tableName: TableName,
  options: PaginationOptions
): Promise<PaginatedResult<T>> {
  const {
    page,
    pageSize,
    sortField,
    sortDirection = 'asc',
    searchTerm,
    searchFields = [],
    filters = {},
    idIn,
  } = options;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query: any = supabase
    .from(tableName)
    .select('*', { count: 'exact' });

  // Server-side search across multiple columns
  const trimmedSearch = searchTerm?.trim();
  if (trimmedSearch && searchFields.length > 0) {
    // Escape PostgREST `or()` reserved chars by wrapping the pattern in double
    // quotes; backslashes and quotes inside the value must themselves be escaped.
    const escaped = trimmedSearch.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safe = `"%${escaped}%"`;
    const orClauses = searchFields
      .map(field => `${field}.ilike.${safe}`)
      .join(',');
    query = query.or(orClauses);
  }


  // Restrict to a specific set of ids (e.g. records linked to deals)
  if (idIn) {
    // Empty set must match nothing; use a non-existent uuid sentinel.
    query = query.in('id', idIn.length > 0 ? idIn : ['00000000-0000-0000-0000-000000000000']);
  }

  // Server-side equality filters
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== 'all') {
      query = query.eq(key, value);
    }
  }

  // Server-side sorting
  // Server-side sorting. Always add `id` as a secondary key so rows with an
  // identical primary sort value (common right after a bulk import) have a
  // stable order across page boundaries — otherwise a full paginated export
  // can skip or duplicate rows.
  if (sortField) {
    query = query.order(sortField, { ascending: sortDirection === 'asc' });
  } else {
    const defaultSort = tableName === 'deals' ? 'modified_at' : 'created_time';
    query = query.order(defaultSort, { ascending: false });
  }
  query = query.order('id', { ascending: true });

  // Pagination range
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) throw error;

  return {
    data: (data || []) as T[],
    totalCount: count ?? 0,
  };
}

/**
 * Fetch ALL records from a table by looping through paginated requests of 1000 rows.
 * Used for CSV exports and hooks that need the complete dataset.
 */
export async function fetchAllRecords<T = any>(
  tableName: TableName,
  orderField: string = 'created_time',
  ascending: boolean = false
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order(orderField, { ascending })
      // Tie-break on id so identical `orderField` values page deterministically.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    allData = [...allData, ...(data || []) as T[]];
    hasMore = (data?.length || 0) === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  return allData;
}
