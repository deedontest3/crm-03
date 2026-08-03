import { NotificationBell } from "@/components/NotificationBell";
import { AppLoader } from "@/components/ui/loader";
import { lazy, Suspense, useMemo } from "react";
import { currentFiscalYear } from "@/lib/fiscalYear";
import type { BU, DisplayCurrency } from "@/components/dashboard/RevenueFilters";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useAvailableYears } from "@/hooks/useYearlyRevenueData";

const YearlyRevenueSummary = lazy(() => import("@/components/YearlyRevenueSummary"));

const fallbackYears = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];
const allowedBus: BU[] = ["EBU", "RT", "MBU"];
const allowedCurrencies: DisplayCurrency[] = ["EUR", "USD", "INR"];
const cfy = currentFiscalYear();

const Dashboard = () => {
  const { years: dataYears } = useAvailableYears();

  // Data-driven year list, falling back to a fixed range so first render works
  // even before the years query resolves. Always includes current FY.
  const availableYears = useMemo(() => {
    const set = new Set<number>([...fallbackYears, cfy, ...(dataYears || [])]);
    return Array.from(set).sort((a, b) => a - b);
  }, [dataYears]);

  const defaultYear = availableYears.includes(cfy) ? cfy : availableYears[0] ?? 2025;

  const [selectedYear, setSelectedYear] = usePersistentState<number>(
    "dashboard.selectedYear",
    defaultYear,
    (v) => (typeof v === "number" && Number.isFinite(v) ? v : defaultYear),
  );
  const [bus, setBus] = usePersistentState<BU[]>(
    "dashboard.bus",
    [],
    (v) => (Array.isArray(v) ? v.filter((b) => allowedBus.includes(b)) : []),
  );
  const [currency, setCurrency] = usePersistentState<DisplayCurrency>(
    "dashboard.displayCurrency",
    "EUR",
    (v) => (allowedCurrencies.includes(v) ? v : "EUR"),
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-semibold text-foreground">Revenue Analytics</h1>
          <div className="flex items-center gap-4">
            <NotificationBell placement="down" size="small" />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-6">
        <Suspense fallback={<AppLoader variant="panel" label="Loading revenue analytics…" />}>
          <YearlyRevenueSummary
            selectedYear={selectedYear}
            onYearChange={setSelectedYear}
            bus={bus}
            onBusChange={setBus}
            displayCurrency={currency}
            onCurrencyChange={setCurrency}
            availableYears={availableYears}
            hideHeader
          />
        </Suspense>
      </div>
    </div>
  );
};

export default Dashboard;
