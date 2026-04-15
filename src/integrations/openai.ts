/**
 * OpenAI integration for The Handover.
 *
 * @example
 * ```ts
 * import { HandoverClient } from '@the-handover/sdk';
 * import { handoverToolDefinition, handleHandoverCall } from '@the-handover/sdk/openai';
 *
 * const client = new HandoverClient({ apiKey: 'ho_live_...' });
 *
 * // Add to your tools list
 * const tools = [handoverToolDefinition(), ...otherTools];
 *
 * // In your tool call handler
 * if (toolCall.function.name === 'request_human_approval') {
 *   const result = await handleHandoverCall(client, toolCall.function.arguments, {
 *     approver: 'admin@company.com',
 *   });
 * }
 * ```
 */

import type { HandoverClient } from '../client.js';
import type { ResponseTypeConfig } from '../types.js';
import { DecisionDenied, DecisionExpired } from '../errors.js';

export function handoverToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'request_human_approval',
      description:
        'Request human approval before taking a sensitive, destructive, or costly action. ' +
        'Call this BEFORE executing the action. If the response says DENIED, you must NOT proceed.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Clear description of what you want to do',
          },
          context: {
            type: 'string',
            description: 'Why you want to do this and any relevant details',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'How urgent is this action',
          },
        },
        required: ['action'],
      },
    },
  };
}

export interface HandleCallOptions {
  approver: string;
  channel?: 'email' | 'webhook' | 'slack';
  timeout_minutes?: number;
  response_type?: ResponseTypeConfig;
}

export async function handleHandoverCall(
  client: HandoverClient,
  argumentsJson: string,
  options: HandleCallOptions,
): Promise<string> {
  const args = JSON.parse(argumentsJson);
  const action = args.action || 'Unknown action';
  const context = args.context;
  const urgency = args.urgency || 'medium';

  try {
    const decision = await client.approve({
      action,
      approver: options.approver,
      context,
      urgency,
      timeout_minutes: options.timeout_minutes || 60,
      channel: options.channel || 'email',
      response_type: options.response_type,
    });

    if (decision.status === 'modified') {
      return (
        `MODIFIED: The approver has requested changes. ` +
        `Notes: ${decision.response_notes}. ` +
        `Data: ${JSON.stringify(decision.response_data)}. ` +
        `Adjust your approach accordingly.`
      );
    }

    if (decision.response_data) {
      return (
        `APPROVED by ${decision.resolved_by}. ` +
        `Response data: ${JSON.stringify(decision.response_data)}. ` +
        `You may proceed.`
      );
    }

    return `APPROVED by ${decision.resolved_by}. You may proceed with: ${action}`;
  } catch (err) {
    if (err instanceof DecisionDenied) {
      return (
        'DENIED: The human approver has denied this action. ' +
        'You MUST NOT proceed with this action under any circumstances.'
      );
    }
    if (err instanceof DecisionExpired) {
      return (
        'EXPIRED: The approval request timed out without a response. ' +
        'You MUST NOT proceed without explicit approval.'
      );
    }
    throw err;
  }
}
