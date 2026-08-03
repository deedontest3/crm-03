import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidate every React Query cache that depends on the deals table.
 * Call this after any deal mutation (create / update / archive / restore /
 * hard-delete / import) so revenue analytics and dashboards refresh
 * instantly instead of waiting for staleTime.
 */
export function invalidateDealCaches(queryClient: QueryClient) {
  const keys = [
    ["yearly-revenue-fy"],
    ["dashboard-stats"],
    ["available-fiscal-years"],
    ["deals-all"],
    ["archived-deals"],
    ["deal-revenue-schedule"],
    ["deal-offered-schedule"],
  ];
  keys.forEach((key) => {
    queryClient.invalidateQueries({ queryKey: key });
  });
}
