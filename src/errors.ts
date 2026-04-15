import type { Decision } from './types.js';

export class HandoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoverError';
  }
}

/**
 * Raised when an approver denies an action.
 * This STOPS the agent from proceeding.
 */
export class DecisionDenied extends HandoverError {
  public readonly decision: Decision;

  constructor(decision: Decision, message?: string) {
    super(message || `Action denied by ${decision.resolved_by}: ${decision.action}`);
    this.name = 'DecisionDenied';
    this.decision = decision;
  }
}

/**
 * Raised when a decision times out without a response.
 */
export class DecisionExpired extends HandoverError {
  public readonly decision: Decision;

  constructor(decision: Decision, message?: string) {
    super(message || `Decision expired: ${decision.action}`);
    this.name = 'DecisionExpired';
    this.decision = decision;
  }
}

/**
 * Raised when polling exceeds the max wait time.
 */
export class DecisionTimeout extends HandoverError {
  public readonly decisionId: string;

  constructor(decisionId: string, message?: string) {
    super(message || `Timed out waiting for decision ${decisionId}`);
    this.name = 'DecisionTimeout';
    this.decisionId = decisionId;
  }
}
