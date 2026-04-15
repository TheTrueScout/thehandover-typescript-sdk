export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'modified' | 'expired' | 'escalated';
export type ResponseTypeName = 'approve_deny' | 'choose' | 'text_input' | 'number_input' | 'confirm';

export interface ChooseResponse {
  type: 'choose';
  choices: string[];
  label?: string;
}

export interface TextInputField {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
}

export interface TextInputResponse {
  type: 'text_input';
  fields: TextInputField[];
}

export interface NumberInputResponse {
  type: 'number_input';
  label?: string;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface ConfirmResponse {
  type: 'confirm';
}

export interface ApproveDenyResponse {
  type: 'approve_deny';
}

export type ResponseTypeConfig =
  | ChooseResponse
  | TextInputResponse
  | NumberInputResponse
  | ConfirmResponse
  | ApproveDenyResponse;

export interface CreateDecisionOptions {
  action: string;
  approver: string;
  context?: string;
  urgency?: Urgency;
  timeout_minutes?: number;
  channel?: 'email' | 'webhook' | 'slack';
  options?: ('approve' | 'deny' | 'modify')[];
  callback_url?: string;
  response_type?: ResponseTypeConfig;
}

export interface CreateDecisionResult {
  id: string;
  status: string;
  expires_at: string;
  created_at: string;
  auto_resolved?: boolean;
}

export interface Decision {
  id: string;
  action: string;
  context: string | null;
  urgency: Urgency;
  status: DecisionStatus;
  options: string[];
  timeout_minutes: number;
  response_type: ResponseTypeConfig | null;
  response_notes: string | null;
  response_data: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: string | null;
  expires_at: string;
  created_at: string;
}

export interface ApproveOptions extends CreateDecisionOptions {
  poll_interval?: number;
  max_wait?: number;
}
