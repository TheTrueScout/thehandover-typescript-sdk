import type {
  CreateDecisionOptions,
  CreateDecisionResult,
  Decision,
  ApproveOptions,
} from './types.js';
import { HandoverError, DecisionDenied, DecisionExpired, DecisionTimeout } from './errors.js';

const DEFAULT_BASE_URL = 'https://thehandover.xyz';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface HandoverClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
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

  constructor(options: HandoverClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout || 30000;
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
          'User-Agent': 'the-handover-typescript/0.1.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        throw new HandoverError(
          `API error ${res.status}: ${(data as any).error || res.statusText}`
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

    return this.request<CreateDecisionResult>('POST', '/decisions', body);
  }

  /** Get the current state of a decision. */
  async get(decisionId: string): Promise<Decision> {
    return this.request<Decision>('GET', `/decisions/${decisionId}`);
  }

  /** Programmatically resolve a decision. */
  async resolve(
    decisionId: string,
    action: 'approve' | 'deny' | 'modify',
    options?: { notes?: string; response_data?: Record<string, unknown>; resolved_by?: string },
  ): Promise<Decision> {
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

    return decision;
  }
}
