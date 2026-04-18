import type {
  Attachment,
  CreateDecisionOptions,
  CreateDecisionResult,
  Decision,
  DecisionStatus,
  ApproveOptions,
  ApprovalPolicy,
  Urgency,
} from './types.js';
import { HandoverError, DecisionDenied, DecisionExpired, DecisionTimeout } from './errors.js';
import { promptDecision, nowIso, devId } from './dev.js';

declare const process:
  | {
      env?: Record<string, string | undefined>;
      stdin?: { isTTY?: boolean };
    }
  | undefined;

interface ApiErrorBody {
  error?: string;
  code?: string;
}

interface AttachmentsResponse {
  attachments: Attachment[];
}

const URGENCY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function policyRequires(
  policy: ApprovalPolicy,
  action: string,
  urgency: string,
  amount?: number,
): boolean {
  if (policy.never_require) return false;
  if (policy.always_require) return true;
  const actionLower = action.toLowerCase();
  for (const kw of policy.require_for_keywords ?? []) {
    if (actionLower.includes(kw.toLowerCase())) return true;
  }
  if (policy.require_for_urgency !== undefined) {
    const threshold = URGENCY_RANK[policy.require_for_urgency] ?? 0;
    if ((URGENCY_RANK[urgency] ?? 1) >= threshold) return true;
  }
  if (amount !== undefined) {
    for (const rule of policy.amount_rules ?? []) {
      if (amount >= rule.threshold) {
        const kws = rule.keywords ?? [];
        if (kws.length === 0 || kws.some(kw => actionLower.includes(kw.toLowerCase()))) {
          return true;
        }
      }
    }
  }
  return false;
}

const DEFAULT_BASE_URL = 'https://thehandover.xyz';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface HandoverClientOptions {
  /**
   * API key. Falls back to `process.env.HANDOVER_API_KEY`. If neither is set,
   * the SDK enters dev mode: decisions are printed to the terminal and the
   * developer responds on stdin. Dev mode requires a TTY — in web servers or
   * serverless runtimes you must supply a key.
   */
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  policy?: ApprovalPolicy;
}

/**
 * Client for The Handover API.
 *
 * @example
 * ```ts
 * import { HandoverClient } from '@the-handover/sdk';
 *
 * const client = new HandoverClient({ apiKey: 'ho_live_...' });
 *
 * // Blocks until approved — throws DecisionDenied on denial
 * const decision = await client.approve({
 *   action: 'Delete 500 user records',
 *   approver: 'admin@company.com',
 *   urgency: 'critical',
 * });
 * console.log(`Approved by ${decision.resolved_by}`);
 * ```
 */
export class HandoverClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private policy?: ApprovalPolicy;
  private devMode: boolean;
  private devDecisions: Map<string, Decision> = new Map();

  constructor(options: HandoverClientOptions = {}) {
    const envKey =
      typeof process !== 'undefined' ? process.env?.HANDOVER_API_KEY : undefined;
    const apiKey = options.apiKey ?? envKey ?? '';
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout || 30000;
    this.policy = options.policy;

    if (!apiKey) {
      const hasTty =
        typeof process !== 'undefined' && Boolean(process.stdin?.isTTY);
      if (!hasTty) {
        throw new HandoverError(
          'No HANDOVER_API_KEY set and no interactive terminal available for ' +
          'dev mode. Set HANDOVER_API_KEY for production, or run from a ' +
          'terminal. Get a free key at https://thehandover.xyz/signup',
        );
      }
      this.apiKey = '';
      this.devMode = true;
      return;
    }

    this.apiKey = apiKey;
    this.devMode = false;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'the-handover-typescript/0.3.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json() as unknown;

      if (!res.ok) {
        const errorBody = data as ApiErrorBody;
        throw new HandoverError(
          `API error ${res.status}: ${errorBody.error || res.statusText}`
        );
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Core API methods ─────────────────────────────────────────────

  /**
   * Create a decision request (non-blocking).
   * For most use cases, prefer `approve()` which blocks until resolved.
   */
  async create(options: CreateDecisionOptions): Promise<CreateDecisionResult> {
    if (this.devMode) return this.devCreate(options);
    const body: Record<string, unknown> = {
      action: options.action,
      approver: options.approver,
      urgency: options.urgency || 'medium',
      timeout_minutes: options.timeout_minutes || 60,
      channel: options.channel || 'email',
    };
    if (options.context) body.context = options.context;
    if (options.options) body.options = options.options;
    if (options.callback_url) body.callback_url = options.callback_url;
    if (options.response_type) body.response_type = options.response_type;
    if (options.context_images) body.context_images = options.context_images;
    if (options.enforce) body.enforce = true;

    return this.request<CreateDecisionResult>('POST', '/decisions', body);
  }

  // ── Attachments ──────────────────────────────────────────────────

  /**
   * Attach a file to a pending decision for the approver to review.
   *
   * Accepted types include images, PDFs, common office documents, plain text,
   * CSV, Markdown, JSON, XML, and RTF. Max 10MB per file, 5 files per decision.
   *
   * @returns The full list of attachments now on the decision.
   */
  async uploadAttachment(
    decisionId: string,
    file: File | Blob,
    filename?: string,
  ): Promise<Attachment[]> {
    if (this.devMode) {
      const name = filename || (file instanceof File ? file.name : 'upload');
      const attachment: Attachment = {
        name,
        url: `dev://local/${name}`,
        type: file.type || 'application/octet-stream',
        size: file.size,
      };
      const decision = this.devDecisions.get(decisionId);
      if (decision) {
        decision.attachments = [...(decision.attachments || []), attachment];
      }
      return [attachment];
    }

    const form = new FormData();
    if (file instanceof File) {
      form.append('file', file);
    } else {
      form.append('file', file, filename || 'upload');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}/decisions/${decisionId}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'the-handover-typescript/0.3.0',
        },
        body: form,
        signal: controller.signal,
      });

      const data = await res.json() as unknown;

      if (!res.ok) {
        const errorBody = data as ApiErrorBody;
        throw new HandoverError(
          `API error ${res.status}: ${errorBody.error || res.statusText}`
        );
      }

      return (data as AttachmentsResponse).attachments;
    } finally {
      clearTimeout(timer);
    }
  }

  /** List attachments currently on a decision. */
  async listAttachments(decisionId: string): Promise<Attachment[]> {
    if (this.devMode) {
      const decision = this.devDecisions.get(decisionId);
      return decision ? [...(decision.attachments || [])] : [];
    }
    const data = await this.request<AttachmentsResponse>(
      'GET',
      `/decisions/${decisionId}/attachments`,
    );
    return data.attachments;
  }

  /** Get the current state of a decision. */
  async get(decisionId: string): Promise<Decision> {
    if (this.devMode) {
      const decision = this.devDecisions.get(decisionId);
      if (!decision) throw new HandoverError(`Decision ${decisionId} not found (dev mode)`);
      return decision;
    }
    return this.request<Decision>('GET', `/decisions/${decisionId}`);
  }

  /** Programmatically resolve a decision. */
  async resolve(
    decisionId: string,
    action: 'approve' | 'deny' | 'modify',
    options?: { notes?: string; response_data?: Record<string, unknown>; resolved_by?: string },
  ): Promise<Decision> {
    if (this.devMode) {
      const decision = this.devDecisions.get(decisionId);
      if (!decision) throw new HandoverError(`Decision ${decisionId} not found (dev mode)`);
      const statusMap: Record<string, DecisionStatus> = {
        approve: 'approved',
        deny: 'denied',
        modify: 'modified',
      };
      decision.status = statusMap[action] || 'modified';
      decision.response_notes = options?.notes ?? null;
      decision.response_data = options?.response_data ?? null;
      decision.resolved_by = options?.resolved_by ?? 'dev@local';
      decision.resolved_at = nowIso();
      return decision;
    }
    return this.request<Decision>('POST', `/decisions/${decisionId}/resolve`, {
      action,
      ...options,
    });
  }

  // ── Polling ──────────────────────────────────────────────────────

  /**
   * Poll a decision until resolved or expired.
   * @throws DecisionTimeout if max_wait is exceeded
   */
  async poll(
    decisionId: string,
    options?: { interval?: number; max_wait?: number },
  ): Promise<Decision> {
    const interval = options?.interval || 2000;
    const maxWait = options?.max_wait || 3600000;
    const start = Date.now();

    while (true) {
      const decision = await this.get(decisionId);
      if (decision.status !== 'pending') return decision;

      const elapsed = Date.now() - start;
      if (elapsed >= maxWait) throw new DecisionTimeout(decisionId);

      await sleep(Math.min(interval, maxWait - elapsed));
    }
  }

  // ── Dev mode ─────────────────────────────────────────────────────

  private async devCreate(options: CreateDecisionOptions): Promise<CreateDecisionResult> {
    const urgency = options.urgency ?? 'medium';
    const result = await promptDecision({
      action: options.action,
      approver: options.approver,
      urgency,
      context: options.context,
      responseType: options.response_type,
    });
    const now = nowIso();
    const id = devId();
    const decision: Decision = {
      id,
      action: options.action,
      context: options.context ?? null,
      urgency: urgency as Urgency,
      status: result.status,
      options: [],
      timeout_minutes: options.timeout_minutes ?? 60,
      response_type: options.response_type ?? null,
      response_notes: result.notes,
      response_data: result.responseData,
      resolved_at: now,
      resolved_by: 'dev@local',
      expires_at: now,
      created_at: now,
      execute_at: result.executeAt,
      context_images: options.context_images ?? null,
      attachments: null,
      enforce: options.enforce ?? false,
      action_permitted: options.enforce
        ? ['approved', 'modified', 'scheduled'].includes(result.status)
        : undefined,
    };
    this.devDecisions.set(id, decision);
    return {
      id,
      status: result.status,
      expires_at: now,
      created_at: now,
      auto_resolved: true,
    };
  }

  // ── High-level enforcement ───────────────────────────────────────

  /**
   * Request approval and block until resolved.
   *
   * **This is the primary enforcement mechanism.** It:
   * 1. Creates a decision request
   * 2. Polls until the approver responds
   * 3. Returns the Decision if approved/modified
   * 4. **Throws DecisionDenied if denied** — the agent cannot proceed
   * 5. **Throws DecisionExpired if it times out** — the agent cannot proceed
   *
   * @example
   * ```ts
   * const decision = await client.approve({
   *   action: 'Send 10,000 marketing emails',
   *   approver: 'marketing-lead@company.com',
   *   urgency: 'high',
   * });
   * // If we reach this line, it was approved.
   * // A denial throws DecisionDenied.
   * ```
   */
  async approve(options: ApproveOptions): Promise<Decision> {
    const urgency = options.urgency ?? 'medium';
    if (this.policy !== undefined && !policyRequires(this.policy, options.action, urgency, options.amount)) {
      return {
        id: 'auto',
        action: options.action,
        context: options.context ?? null,
        urgency: urgency as Urgency,
        status: 'approved',
        options: [],
        timeout_minutes: options.timeout_minutes ?? 60,
        response_type: null,
        response_notes: 'Auto-approved — action did not match any policy rule.',
        response_data: null,
        resolved_at: new Date().toISOString(),
        resolved_by: null,
        expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
    }

    const result = await this.create(options);

    if (result.auto_resolved) {
      return this.get(result.id);
    }

    const decision = await this.poll(result.id, {
      interval: options.poll_interval || 2000,
      max_wait: options.max_wait || 3600000,
    });

    if (decision.status === 'denied') {
      throw new DecisionDenied(decision);
    }

    if (decision.status === 'expired') {
      throw new DecisionExpired(decision);
    }

    if (decision.status === 'escalated') {
      throw new DecisionExpired(
        decision,
        `Decision escalated after timeout: ${options.action}`,
      );
    }

    if (decision.status === 'scheduled' && decision.execute_at) {
      const executeTime = new Date(decision.execute_at).getTime();
      const waitMs = executeTime - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    return decision;
  }
}
