/**
 * LangChain integration for The Handover.
 *
 * @example
 * ```ts
 * import { HandoverClient } from '@the-handover/sdk';
 * import { HandoverApprovalTool } from '@the-handover/sdk/langchain';
 *
 * const client = new HandoverClient({ apiKey: 'ho_live_...' });
 * const tool = new HandoverApprovalTool({
 *   client,
 *   approver: 'admin@company.com',
 * });
 *
 * // Use with any LangChain agent
 * const agent = createReactAgent({ llm, tools: [tool, ...otherTools] });
 * ```
 */

import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { HandoverClient } from '../client.js';
import type { ResponseTypeConfig } from '../types.js';
import { DecisionDenied, DecisionExpired } from '../errors.js';

const ApprovalSchema = z.object({
  action: z.string().describe('What the agent wants to do — shown to the human approver'),
  context: z.string().optional().describe('Additional context to help the approver decide'),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Urgency level'),
});

export interface HandoverApprovalToolOptions {
  client: HandoverClient;
  approver: string;
  defaultUrgency?: 'low' | 'medium' | 'high' | 'critical';
  channel?: 'email' | 'webhook' | 'slack';
  timeoutMinutes?: number;
  responseType?: ResponseTypeConfig;
}

export class HandoverApprovalTool extends StructuredTool {
  name = 'request_human_approval';
  description =
    'Request human approval before taking a sensitive action. ' +
    'Call this BEFORE executing any action that could be destructive, costly, or irreversible. ' +
    'Returns APPROVED or MODIFIED with instructions. Returns a DENIED string if refused — ' +
    'you MUST NOT proceed in that case.';
  schema = ApprovalSchema;

  private client: HandoverClient;
  private approver: string;
  private defaultUrgency: string;
  private channel: string;
  private timeoutMinutes: number;
  private responseType?: ResponseTypeConfig;

  constructor(options: HandoverApprovalToolOptions) {
    super();
    this.client = options.client;
    this.approver = options.approver;
    this.defaultUrgency = options.defaultUrgency || 'medium';
    this.channel = options.channel || 'email';
    this.timeoutMinutes = options.timeoutMinutes || 60;
    this.responseType = options.responseType;
  }

  async _call(input: z.infer<typeof ApprovalSchema>): Promise<string> {
    try {
      const decision = await this.client.approve({
        action: input.action,
        approver: this.approver,
        context: input.context,
        urgency: (input.urgency as any) || this.defaultUrgency,
        timeout_minutes: this.timeoutMinutes,
        channel: this.channel as any,
        response_type: this.responseType,
      });

      if (decision.status === 'modified') {
        return (
          `MODIFIED: The approver wants changes. ` +
          `Notes: ${decision.response_notes}. ` +
          `Data: ${JSON.stringify(decision.response_data)}. ` +
          `Adjust your action accordingly.`
        );
      }

      if (decision.response_data) {
        return (
          `APPROVED by ${decision.resolved_by}. ` +
          `Response data: ${JSON.stringify(decision.response_data)}`
        );
      }

      return `APPROVED by ${decision.resolved_by}. You may proceed with: ${input.action}`;
    } catch (err) {
      if (err instanceof DecisionDenied) {
        return (
          `DENIED: The human approver denied this action: ${input.action}. ` +
          `You MUST NOT proceed with this action under any circumstances.`
        );
      }
      if (err instanceof DecisionExpired) {
        return (
          `EXPIRED: The approval request timed out for: ${input.action}. ` +
          `You MUST NOT proceed without explicit approval.`
        );
      }
      throw err;
    }
  }
}
