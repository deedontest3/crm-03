import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, Mail } from 'lucide-react';

interface TemplatePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: {
    name: string;
    subject: string;
    body: string;
  } | null;
}

const sampleData: Record<string, string> = {
  '{{contact_name}}': 'John Doe',
  '{{company_name}}': 'Acme Corporation',
  '{{position}}': 'Sales Manager',
  '{{email}}': 'john.doe@acme.com',
  '{{phone}}': '+1 (555) 123-4567',
  '{{website}}': 'www.acme.com',
  '{{lead_name}}': 'Jane Smith',
  '{{account_name}}': 'Enterprise Solutions Inc.',
};

const renderWithVariables = (text: string): string => {
  let rendered = text;
  Object.entries(sampleData).forEach(([variable, value]) => {
    rendered = rendered.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value);
  });
  return rendered;
};

const TemplatePreviewModal = ({ open, onOpenChange, template }: TemplatePreviewModalProps) => {
  if (!template) return null;

  const renderedSubject = renderWithVariables(template.subject);
  const renderedBody = renderWithVariables(template.body);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview: {template.name}
          </DialogTitle>
          <DialogDescription>
            See how your template looks with sample data
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <div className="border rounded-lg overflow-hidden bg-background">
            <div className="border-b p-4 bg-muted/30">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground w-16">To:</span>
                  <span className="text-sm">{sampleData['{{email}}']}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground ml-6 w-16">Subject:</span>
                  <span className="text-sm font-medium">{renderedSubject}</span>
                </div>
              </div>
            </div>

            <ScrollArea className="h-[350px]">
              <div 
                className="p-4 text-sm whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: renderedBody }}
              />
            </ScrollArea>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t mt-auto">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplatePreviewModal;
