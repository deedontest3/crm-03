import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StandardPagination } from '@/components/shared/StandardPagination';
import { Search, RefreshCw, Download, Mail, XCircle, Eye, Reply, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface EmailRecord {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  sender_email: string;
  subject: string;
  body: string | null;
  status: string;
  sent_at: string;
  sent_by: string | null;
  open_count: number | null;
  unique_opens: number | null;
  opened_at: string | null;
  bounce_type: string | null;
  bounce_reason: string | null;
  bounced_at: string | null;
  reply_count: number | null;
  replied_at: string | null;
  contact_id: string | null;
  lead_id: string | null;
  account_id: string | null;
  delivered_at: string | null;
}

const ITEMS_PER_PAGE = 15;

const EmailHistorySettings = () => {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState('30');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(dateRange));

      const { data, error } = await supabase
        .from('email_history')
        .select('*')
        .gte('sent_at', daysAgo.toISOString())
        .order('sent_at', { ascending: false });

      if (error) throw error;
      setEmails((data as EmailRecord[]) || []);
    } catch (err) {
      console.error('Error fetching email history:', err);
      toast.error('Failed to load email history');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const stats = useMemo(() => {
    const total = emails.length;
    const bounced = emails.filter(e => e.bounce_type || e.status === 'bounced').length;
    const opened = emails.filter(e => (e.open_count ?? 0) > 0).length;
    const replied = emails.filter(e => e.status === 'replied' || (e.reply_count ?? 0) > 0).length;
    const nonBounced = total - bounced;
    return {
      total, bounced, opened, replied,
      openRate: nonBounced > 0 ? Math.round((opened / nonBounced) * 100) : 0,
    };
  }, [emails]);

  const filteredEmails = useMemo(() => {
    let result = emails;

    if (activeStatFilter) {
      if (activeStatFilter === 'bounced') result = result.filter(e => e.bounce_type || e.status === 'bounced');
      else if (activeStatFilter === 'opened') result = result.filter(e => (e.open_count ?? 0) > 0);
      else if (activeStatFilter === 'replied') result = result.filter(e => e.status === 'replied' || (e.reply_count ?? 0) > 0);
    }

    if (statusFilter !== 'all') {
      result = result.filter(e => e.status === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.recipient_email.toLowerCase().includes(q) ||
        (e.recipient_name?.toLowerCase().includes(q)) ||
        e.subject.toLowerCase().includes(q)
      );
    }

    return result;
  }, [emails, search, statusFilter, activeStatFilter]);

  const totalPages = Math.ceil(filteredEmails.length / ITEMS_PER_PAGE);
  const paginatedEmails = filteredEmails.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, activeStatFilter]);

  const handleExportCSV = () => {
    const headers = ['Recipient', 'Subject', 'Status', 'Sent At', 'Opens', 'Replies'];
    const rows = filteredEmails.map(e => [
      e.recipient_email, e.subject, e.status,
      format(new Date(e.sent_at), 'dd-MM-yyyy HH:mm'),
      e.open_count ?? 0, e.reply_count ?? 0
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `email_history_${dateRange}d.csv`;
    link.click();
    toast.success('CSV exported');
  };

  const getStatusBadge = (email: EmailRecord) => {
    if (email.bounce_type || email.status === 'bounced') {
      return <Badge variant="destructive">Bounced</Badge>;
    }
    if (email.status === 'replied' || (email.reply_count ?? 0) > 0) {
      return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">Replied</Badge>;
    }
    if ((email.open_count ?? 0) > 0) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Opened</Badge>;
    }
    if (email.delivered_at) {
      return <Badge variant="secondary">Delivered</Badge>;
    }
    return <Badge variant="outline">Sent</Badge>;
  };

  const toggleStatFilter = (filter: string) => {
    setActiveStatFilter(prev => prev === filter ? null : filter);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className={cn("cursor-pointer hover:shadow-md transition-all", activeStatFilter === 'total' && "ring-1 ring-primary")}
          onClick={() => toggleStatFilter('total')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("cursor-pointer hover:shadow-md transition-all", activeStatFilter === 'bounced' && "ring-1 ring-destructive")}
          onClick={() => toggleStatFilter('bounced')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <div>
                <p className="text-xl font-bold text-destructive">{stats.bounced}</p>
                <p className="text-xs text-muted-foreground">Bounced</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("cursor-pointer hover:shadow-md transition-all", activeStatFilter === 'opened' && "ring-1 ring-green-500")}
          onClick={() => toggleStatFilter('opened')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-xl font-bold">{stats.opened}</p>
                <p className="text-xs text-muted-foreground">Opened</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn("cursor-pointer hover:shadow-md transition-all", activeStatFilter === 'replied' && "ring-1 ring-purple-500")}
          onClick={() => toggleStatFilter('replied')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Reply className="h-4 w-4 text-purple-500" />
              <div>
                <p className="text-xl font-bold">{stats.replied}</p>
                <p className="text-xs text-muted-foreground">Replied</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              <div>
                <p className="text-xl font-bold">{stats.openRate}%</p>
                <p className="text-xs text-muted-foreground">Open Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search emails..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="bounced">Bounced</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={fetchEmails}><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filteredEmails.length === 0}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Sent At</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Opens</TableHead>
              <TableHead className="text-center">Replies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEmails.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {emails.length === 0 ? 'No emails sent yet' : 'No emails match your filters'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedEmails.map(email => (
                <TableRow key={email.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEmail(email)}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm truncate max-w-[200px]">{email.recipient_name || email.recipient_email}</p>
                      {email.recipient_name && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{email.recipient_email}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[250px] truncate text-sm">{email.subject}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{format(new Date(email.sent_at), 'dd-MM-yy HH:mm')}</TableCell>
                  <TableCell>{getStatusBadge(email)}</TableCell>
                  <TableCell className="text-center text-sm">{email.open_count ?? 0}</TableCell>
                  <TableCell className="text-center text-sm">{email.reply_count ?? 0}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <StandardPagination currentPage={currentPage} totalPages={totalPages} totalItems={filteredEmails.length} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Email Details</DialogTitle>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <span className="text-muted-foreground">To:</span>
                <span>{selectedEmail.recipient_name ? `${selectedEmail.recipient_name} <${selectedEmail.recipient_email}>` : selectedEmail.recipient_email}</span>
                <span className="text-muted-foreground">From:</span>
                <span>{selectedEmail.sender_email}</span>
                <span className="text-muted-foreground">Subject:</span>
                <span className="font-medium">{selectedEmail.subject}</span>
                <span className="text-muted-foreground">Sent:</span>
                <span>{format(new Date(selectedEmail.sent_at), 'dd MMM yyyy HH:mm')}</span>
                <span className="text-muted-foreground">Status:</span>
                <span>{getStatusBadge(selectedEmail)}</span>
                <span className="text-muted-foreground">Opens:</span>
                <span>{selectedEmail.open_count ?? 0}</span>
              </div>
              {selectedEmail.bounce_type && (
                <div className="bg-destructive/10 p-3 rounded-md">
                  <p className="font-medium text-destructive">Bounce: {selectedEmail.bounce_type}</p>
                  {selectedEmail.bounce_reason && <p className="text-xs mt-1">{selectedEmail.bounce_reason}</p>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmailHistorySettings;
