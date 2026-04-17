export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'modified' | 'expired' | 'escalated' | 'scheduled';
export type ResponseTypeName =
  | 'approve_deny'
  | 'choose'
  | 'text_input'
  | 'number_input'
  | 'confirm'
  | 'schedule'
  | 'file_upload';

/** A file attached to a decision — either by the agent as context for the
 *  approver, or uploaded by the approver as part of their response. */
export interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

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

/**
 * Ask the approver to upload one or more files as their response.
 *
 * The uploaded files appear on the returned Decision under
 * `response_data.uploaded_files`, each as `{ name, url, type, size }`.
 *
 * @example
 * ```ts
 * const decision = await client.approve({
 *   action: 'Provide signed NDA before we proceed',
 *   approver: 'legal@company.com',
 *   response_type: { type: 'file_upload', label: 'Upload signed NDA', accept: ['application/pdf'] },
 * });
 * ```
 */
export interface FileUploadResponse {
  type: 'file_upload';
  label?: string;
  /** Maximum number of files the approver may upload. Defaults to 5. */
  max_files?: number;
  /** MIME types or extensions accepted, e.g. `['image/*', '.pdf']`. */
  accept?: string[];
}

export type ResponseTypeConfig =
  | ChooseResponse
  | TextInputResponse
  | NumberInputResponse
  | ConfirmResponse
  | ApproveDenyResponse
  | ScheduleResponse
  | FileUploadResponse;

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
  /** Up to 5 HTTP(S) URLs of images the approver should see alongside the action. */
  context_images?: string[];
  /** When `true` the server returns `action_permitted` on the decision so
   *  callers can gate execution without re-checking status fields. */
  enforce?: boolean;
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
  /** HTTP(S) URLs of images the agent attached as context for the approver. */
  context_images?: string[] | null;
  /** Files the agent uploaded for the approver to review. */
  attachments?: Attachment[] | null;
  /** Whether the decision was created with server-side enforcement. */
  enforce?: boolean;
  /** Present only when `enforce === true`. `true` means the action is approved
   *  and may proceed; `false` means it must not. */
  action_permitted?: boolean;
}

export interface ApproveOptions extends CreateDecisionOptions {
  poll_interval?: number;
  max_wait?: number;
  /**
   * Numeric amount associated with this action (e.g. a dollar value for a
   * financial transaction). Evaluated against any {@link AmountRule} in the
   * active policy.
   */
  amount?: number;
}

/**
 * Require approval when a numeric amount meets or exceeds a threshold.
 *
 * Pass `amount` to `client.approve()` and the SDK will compare it against
 * every `AmountRule` in the active policy.
 *
 * @example
 * ```ts
 * const client = new HandoverClient({
 *   apiKey: 'ho_live_...',
 *   policy: {
 *     amount_rules: [
 *       { threshold: 100, keywords: ['payment', 'charge', 'transfer'], currency: 'USD' },
 *     ],
 *   },
 * });
 *
 * // Triggers approval — $250 exceeds the $100 threshold.
 * await client.approve({ action: 'Process payment', approver: 'finance@co.com', amount: 250 });
 *
 * // Auto-approved — $50 is below threshold.
 * await client.approve({ action: 'Process payment', approver: 'finance@co.com', amount: 50 });
 * ```
 */
export interface AmountRule {
  /** The minimum value (inclusive) that triggers approval. */
  threshold: number;
  /**
   * If provided, the rule only fires when the action text also contains at
   * least one of these strings (case-insensitive). Leave empty to apply the
   * threshold to any action that carries an amount.
   */
  keywords?: string[];
  /** Informational label (e.g. `'USD'`). The SDK does not convert currencies. */
  currency?: string;
}

/**
 * Defines which agent actions require human approval.
 *
 * Attach a policy to {@link HandoverClient} so you don't have to scatter
 * approval logic through your agent code. The agent always calls
 * `client.approve()`; the policy decides whether that becomes a real
 * approval request or an instant auto-approval.
 *
 * Rules are **OR-combined**: if *any* rule matches the action, approval is required.
 */
export interface ApprovalPolicy {
  /**
   * Approval required when the action text contains any of these strings
   * (case-insensitive).
   */
  require_for_keywords?: string[];
  /**
   * Approval required when `urgency` is at or above this level.
   * `'high'` means both `'high'` and `'critical'` trigger approval.
   */
  require_for_urgency?: Urgency;
  /**
   * Approval required when the caller passes `amount` and it meets or exceeds
   * a rule's threshold.
   */
  amount_rules?: AmountRule[];
  /** Require approval for every action regardless of other rules. */
  always_require?: boolean;
  /** Skip approval for every action (auto-approve all). Useful in dev/CI. */
  never_require?: boolean;
}

/**
 * Keywords that commonly indicate a write, destructive, or high-risk action.
 * Used by {@link DEFAULT_POLICY}.
 */
export const DEFAULT_KEYWORDS: string[] = [
  // Destructive / write operations
  'delete', 'remove', 'drop', 'truncate', 'purge', 'wipe', 'erase',
  'update', 'modify', 'edit', 'patch', 'overwrite', 'replace',
  'create', 'insert', 'add', 'write', 'upload', 'import',
  // Outbound communications
  'send', 'email', 'notify', 'message', 'post', 'publish', 'broadcast',
  'announce', 'alert', 'sms', 'call', 'webhook',
  // Financial
  'payment', 'charge', 'transfer', 'refund', 'invoice', 'billing',
  'purchase', 'buy', 'subscribe', 'withdraw', 'deposit',
  // Infrastructure / deployments
  'deploy', 'release', 'migrate', 'rollback', 'restart', 'reboot',
  'shutdown', 'terminate', 'provision', 'scale',
  // Access / permissions
  'grant', 'revoke', 'invite', 'ban', 'block', 'reset password',
];

/**
 * A ready-to-use policy covering common risky action categories.
 * Pass it directly to {@link HandoverClient} as a starting point.
 *
 * - Keywords: destructive writes, outbound comms, financial ops, infra, access changes.
 * - Urgency: `'high'` and `'critical'` always require approval.
 * - Amount: financial actions over $100 require approval.
 *
 * @example
 * ```ts
 * import { HandoverClient, DEFAULT_POLICY } from '@the-handover/sdk';
 * const client = new HandoverClient({ apiKey: 'ho_live_...', policy: DEFAULT_POLICY });
 * ```
 */
export const DEFAULT_POLICY: ApprovalPolicy = {
  require_for_keywords: DEFAULT_KEYWORDS,
  require_for_urgency: 'high',
  amount_rules: [
    {
      threshold: 100,
      keywords: ['payment', 'charge', 'transfer', 'refund', 'invoice',
                 'purchase', 'buy', 'withdraw', 'deposit', 'billing'],
      currency: 'USD',
    },
  ],
};
