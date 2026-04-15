# @the-handover/sdk

Human-in-the-loop approval SDK for AI agents. Stop agents from taking destructive actions without human sign-off.

## Install

```bash
npm install @the-handover/sdk
```

## Quick Start

```typescript
import { HandoverClient, DecisionDenied } from '@the-handover/sdk';

const client = new HandoverClient({ apiKey: 'ho_live_...' });

try {
  const decision = await client.approve({
    action: 'Delete 500 user records',
    approver: 'admin@company.com',
    urgency: 'critical',
  });
  console.log(`Approved by ${decision.resolved_by}`);
  // Proceed with action...
} catch (err) {
  if (err instanceof DecisionDenied) {
    console.log('Denied — agent stopped');
    // Agent CANNOT proceed
  }
}
```

## Rich Responses

```typescript
import { HandoverClient, ChooseResponse } from '@the-handover/sdk';

const client = new HandoverClient({ apiKey: 'ho_live_...' });

const decision = await client.approve({
  action: 'Select deployment target',
  approver: 'ops@company.com',
  response_type: {
    type: 'choose',
    choices: ['staging', 'production', 'canary'],
    label: 'Which environment?',
  },
});
console.log(`Deploying to: ${decision.response_data?.chosen}`);
```

## OpenAI Integration

```typescript
import { HandoverClient } from '@the-handover/sdk';
import { handoverToolDefinition, handleHandoverCall } from '@the-handover/sdk/openai';

const client = new HandoverClient({ apiKey: 'ho_live_...' });

// Add to your tools
const tools = [handoverToolDefinition()];

// Handle tool calls
if (toolCall.function.name === 'request_human_approval') {
  const result = await handleHandoverCall(client, toolCall.function.arguments, {
    approver: 'admin@company.com',
  });
}
```

## LangChain Integration

```typescript
import { HandoverClient } from '@the-handover/sdk';
import { HandoverApprovalTool } from '@the-handover/sdk/langchain';

const client = new HandoverClient({ apiKey: 'ho_live_...' });
const tool = new HandoverApprovalTool({
  client,
  approver: 'admin@company.com',
});
```

## Docs

Full documentation at [thehandover.xyz/docs](https://thehandover.xyz/docs)
