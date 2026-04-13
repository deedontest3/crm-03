import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Mail, Eye, TrendingUp, Download, XCircle, Reply, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DailyStats {
  date: string;
  sent: number;
  opened: number;
  bounced: number;
  replied: number;
}

interface StatusDistribution {
  name: string;
  value: number;
}

export const EmailAnalyticsDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dateRange, setDateRange] = useState('30');
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [statusDistribution, setStatusDistribution] = useState<StatusDistribution[]>([]);
  const [totals, setTotals] = useState({
    totalSent: 0, totalOpened: 0, totalBounced: 0, totalReplied: 0,
    openRate: 0, bounceRate: 0, replyRate: 0,
  });

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const user = await supabase.auth.getUser();
        if (!user.data.user) return;

        const days = parseInt(dateRange);
        const startDate = startOfDay(subDays(new Date(), days));
        const endDate = endOfDay(new Date());

        const { data: emails, error } = await supabase
          .from('email_history')
          .select('*')
          .gte('sent_at', startDate.toISOString())
          .lte('sent_at', endDate.toISOString())
          .order('sent_at', { ascending: true });

        if (error) throw error;

        const totalSent = emails?.length || 0;
        const totalOpened = emails?.filter((e: any) => e.open_count && e.open_count > 0).length || 0;
        const totalBounced = emails?.filter((e: any) => e.bounce_type || e.status === 'bounced').length || 0;
        const totalReplied = emails?.filter((e: any) => e.status === 'replied' || (e.reply_count && e.reply_count > 0)).length || 0;
        const nonBouncedCount = totalSent - totalBounced;

        setTotals({
          totalSent, totalOpened, totalBounced, totalReplied,
          openRate: nonBouncedCount > 0 ? Math.round((totalOpened / nonBouncedCount) * 100) : 0,
          bounceRate: totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0,
          replyRate: nonBouncedCount > 0 ? Math.round((totalReplied / nonBouncedCount) * 100) : 0,
        });

        const dateInterval = eachDayOfInterval({ start: startDate, end: endDate });
        const dailyData: DailyStats[] = dateInterval.map(date => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const dayEmails = emails?.filter((e: any) => format(new Date(e.sent_at), 'yyyy-MM-dd') === dateStr) || [];
          return {
            date: format(date, 'dd MMM'),
            sent: dayEmails.length,
            opened: dayEmails.filter((e: any) => e.open_count && e.open_count > 0).length,
            bounced: dayEmails.filter((e: any) => e.bounce_type || e.status === 'bounced').length,
            replied: dayEmails.filter((e: any) => e.status === 'replied' || (e.reply_count && e.reply_count > 0)).length,
          };
        });
        setDailyStats(dailyData);

        const statusCounts: Record<string, number> = {};
        emails?.forEach((email: any) => {
          let status = email.status || 'sent';
          if (email.bounce_type) status = 'bounced';
          if (email.reply_count && email.reply_count > 0) status = 'replied';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        setStatusDistribution(Object.entries(statusCounts).map(([name, value]) => ({ name, value })));
      } catch (error) {
        console.error('Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, [dateRange]);

  const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];

  const handleExport = () => {
    setExporting(true);
    try {
      const headers = ["Date", "Sent", "Opened", "Bounced", "Replied"];
      const rows = dailyStats.map(s => [s.date, s.sent, s.opened, s.bounced, s.replied]);
      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `email_analytics_${dateRange}d.csv`;
      link.click();
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold">Email Analytics</h2>
          <p className="text-sm text-muted-foreground">Track your email performance and engagement</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport} disabled={dailyStats.length === 0 || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg"><Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div>
            <div><p className="text-2xl font-bold">{totals.totalSent}</p><p className="text-xs text-muted-foreground">Emails Sent</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg"><Eye className="h-5 w-5 text-green-600 dark:text-green-400" /></div>
            <div><p className="text-2xl font-bold">{totals.openRate}%</p><p className="text-xs text-muted-foreground">Open Rate</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg"><TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400" /></div>
            <div><p className="text-2xl font-bold">{totals.totalOpened}</p><p className="text-xs text-muted-foreground">Total Opens</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg"><XCircle className="h-5 w-5 text-red-600 dark:text-red-400" /></div>
            <div><p className="text-2xl font-bold text-destructive">{totals.totalBounced}</p><p className="text-xs text-muted-foreground">Bounced ({totals.bounceRate}%)</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg"><Reply className="h-5 w-5 text-purple-600 dark:text-purple-400" /></div>
            <div><p className="text-2xl font-bold text-purple-600">{totals.totalReplied}</p><p className="text-xs text-muted-foreground">Replied ({totals.replyRate}%)</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Email Activity Over Time</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend />
                  <Line type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} dot={false} name="Sent" />
                  <Line type="monotone" dataKey="opened" stroke="#10b981" strokeWidth={2} dot={false} name="Opened" />
                  <Line type="monotone" dataKey="bounced" stroke="#ef4444" strokeWidth={2} dot={false} name="Bounced" />
                  <Line type="monotone" dataKey="replied" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Replied" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Status Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {statusDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                      {statusDistribution.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">No data available</div>
              )}
            </div>
            {statusDistribution.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {statusDistribution.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="capitalize truncate">{entry.name}: {entry.value}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Daily Engagement</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyStats.slice(-14)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend />
                  <Bar dataKey="sent" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Sent" />
                  <Bar dataKey="opened" fill="#10b981" radius={[4, 4, 0, 0]} name="Opened" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default EmailAnalyticsDashboard;
