export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'modified' | 'expired' | 'escalated' | 'scheduled';
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

/**
 * Let the approver pick *when* the action should run.
 *
 * When used as the `response_type` for an approval request, the approver sees
 * a date/time picker alongside the standard Approve/Deny buttons.  Picking a
 * future time sets the decision status to `'scheduled'` and populates
 * `Decision.execute_at` with the chosen ISO-8601 timestamp.
 *
 * `client.approve()` will automatically sleep until that moment before
 * returning, so the calling agent proceeds at exactly the right time.
 *
 * @example
 * ```ts
 * const decision = await client.approve({
 *   action: 'Run nightly database vacuum',
 *   approver: 'ops@company.com',
 *   response_type: { type: 'schedule', label: 'When should the vacuum run?' },
 * });
 * // Execution resumes at the time the approver chose.
 * ```
 */
export interface ScheduleResponse {
  type: 'schedule';
  /** Text shown above the date/time picker in the approver's email. */
  label?: string;
  /** Whether the approver may also click "Run now" instead of picking a time. Defaults to true. */
  allow_immediate?: boolean;
}

export type ResponseTypeConfig =
  | ChooseResponse
  | TextInputResponse
  | NumberInputResponse
  | ConfirmResponse
  | ApproveDenyResponse
  | ScheduleResponse;

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
  /** ISO-8601 timestamp set when the approver schedules the action for a future time.
   *  Only present when `status === 'scheduled'`. */
  execute_at?: string | null;
}

export interface ApproveOptions extends CreateDecisionOptions {
  poll_interval?: number;
  max_wait?: number;
}
