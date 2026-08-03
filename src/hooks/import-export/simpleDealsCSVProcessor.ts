
import { DealsCSVProcessor } from './dealsCSVProcessor';

// Exact field order as specified, including action items
const DEALS_EXPORT_FIELDS = [
  'id', 'deal_name', 'stage', 'probability', 'drop_reason', 'created_by', 'modified_by', 
  'created_at', 'modified_at', 'lead_name', 'lead_owner', 'project_name', 'customer_name', 
  'region', 'priority', 'internal_comment', 'expected_closing_date', 'customer_need', 
  'customer_challenges', 'current_solution', 'relationship_strength', 'budget', 'business_value', 
  'decision_maker_level', 'is_recurring', 'start_date', 'end_date', 'currency_type', 
  'action_items', 'current_status', 'won_reason', 'lost_reason',
  'opportunity_summary', 'opportunity_description',
  'customer_objection', 'competition', 'competitors', 'final_tcv',
  'po_status', 'expected_signing_date', 'hold_reason', 'revise_date',
  'total_contract_value', 'project_duration', 'quarterly_revenue_q1', 'quarterly_revenue_q2', 
  'quarterly_revenue_q3', 'quarterly_revenue_q4', 'total_revenue', 'closing', 
  'signed_contract_date', 'implementation_start_date', 'handoff_status', 
  'rfq_received_date', 'proposal_due_date', 'rfq_status', 'action_items_json'
];

interface DealsProcessOptions {
  userId: string;
  onProgress?: (processed: number, total: number) => void;
}

// Simplified CSV processor using specialized deals logic
export class SimpleDealsCSVProcessor {
  private dealsProcessor: DealsCSVProcessor;

  constructor() {
    this.dealsProcessor = new DealsCSVProcessor();
  }
  
  async processCSV(csvText: string, options: DealsProcessOptions) {
    console.log('SimpleDealsCSVProcessor: Starting CSV processing with action items');
    
    return await this.dealsProcessor.processCSV(csvText, {
      userId: options.userId,
      onProgress: options.onProgress
    });
  }
}
