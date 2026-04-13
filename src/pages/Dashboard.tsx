import YearlyRevenueSummary from "@/components/YearlyRevenueSummary";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NotificationBell } from "@/components/NotificationBell";
import { CampaignDashboardWidget } from "@/components/dashboard/CampaignDashboardWidget";
import { useState } from "react";

const availableYears = [2023, 2024, 2025, 2026];
const currentYear = new Date().getFullYear();
const defaultYear = availableYears.includes(currentYear) ? currentYear : 2025;

const Dashboard = () => {
  const [selectedYear, setSelectedYear] = useState(defaultYear);

  return <div className="flex flex-col h-full overflow-hidden">
      {/* Header - fixed height matching sidebar */}
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-semibold text-foreground">Revenue Analytics</h1>
          <div className="flex items-center gap-4">
            <NotificationBell placement="down" size="small" />
            <Select value={selectedYear.toString()} onValueChange={value => setSelectedYear(parseInt(value))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(year => <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-auto p-6">
        {/* Yearly Revenue Summary Section */}
        <YearlyRevenueSummary selectedYear={selectedYear} onYearChange={setSelectedYear} hideHeader />

        {/* Campaign Dashboard Widget */}
        <div className="mt-8">
          <CampaignDashboardWidget />
        </div>
      </div>
    </div>;
};
export default Dashboard;