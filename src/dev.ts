import type { ResponseTypeConfig } from './types.js';

declare const process:
  | {
      stdin: NodeJS.ReadableStream & { isTTY?: boolean };
      stdout: NodeJS.WritableStream;
    }
  | undefined;

declare namespace NodeJS {
  interface ReadableStream {}
  interface WritableStream {}
}

interface Rl {
  question(prompt: string): Promise<string>;
  close(): void;
}

const BAR = '='.repeat(62);
const SIGNUP_NUDGE =
  '  Sign up at https://thehandover.xyz for real approvers:\n' +
  '  email, Slack, and mobile push notifications.';

export interface DevPromptResult {
  status: 'approved' | 'denied' | 'modified' | 'scheduled';
  notes: string | null;
  responseData: Record<string, unknown> | null;
  executeAt: string | null;
}

/**
 * Show the decision in the terminal and read the dev's response from stdin.
 * Used when the SDK is initialised without an API key — lets devs try the
 * SDK end-to-end without signing up.
 */
export async function promptDecision(args: {
  action: string;
  approver: string;
  urgency: string;
  context?: string;
  responseType?: ResponseTypeConfig;
}): Promise<DevPromptResult> {
  if (typeof process === 'undefined' || !process.stdin?.isTTY) {
    throw new Error(
      'Dev mode requires an interactive TTY. Set HANDOVER_API_KEY or run from a terminal.',
    );
  }

  const readline = (await import(
    /* @vite-ignore */ 'node:readline/promises' as string
  )) as { createInterface: (o: { input: unknown; output: unknown }) => Rl };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`\n${BAR}`);
    console.log('  The Handover  [dev mode — no API key set]');
    console.log(BAR);
    console.log(`  Action:    ${args.action}`);
    console.log(`  Approver:  ${args.approver}`);
    console.log(`  Urgency:   ${args.urgency}`);
    if (args.context) console.log(`  Context:   ${args.context}`);
    console.log();

    let result: DevPromptResult | null = null;
    while (result === null) {
      const choice = (await rl.question('  [a]pprove  [d]eny  [m]odify > ')).trim().toLowerCase();
      if (choice === 'a' || choice === 'approve') {
        result = { status: 'approved', notes: null, responseData: null, executeAt: null };
      } else if (choice === 'd' || choice === 'deny') {
        const reason = (await rl.question('  Reason (optional): ')).trim();
        result = { status: 'denied', notes: reason || null, responseData: null, executeAt: null };
      } else if (choice === 'm' || choice === 'modify') {
        result = await promptModify(rl, args.responseType);
      } else {
        console.log('  Please answer a, d, or m.');
      }
    }

    console.log(`\n  -> resolved: ${result.status}`);
    console.log(SIGNUP_NUDGE);
    console.log(`${BAR}\n`);
    return result;
  } finally {
    rl.close();
  }
}

async function promptModify(
  rl: { question: (q: string) => Promise<string> },
  responseType?: ResponseTypeConfig,
): Promise<DevPromptResult | null> {
  if (!responseType || responseType.type === 'confirm' || responseType.type === 'approve_deny') {
    const notes = (await rl.question('  Modified action / notes: ')).trim();
    return { status: 'modified', notes: notes || null, responseData: null, executeAt: null };
  }

  if (responseType.type === 'text_input') {
    const data: Record<string, string> = {};
    for (const field of responseType.fields) {
      data[field.name] = (await rl.question(`  ${field.label || field.name}: `)).trim();
    }
    return { status: 'modified', notes: null, responseData: data, executeAt: null };
  }

  if (responseType.type === 'number_input') {
    const raw = (await rl.question(`  ${responseType.label || 'Value'}: `)).trim();
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      console.log('  Not a valid number.');
      return null;
    }
    return { status: 'modified', notes: null, responseData: { value: num }, executeAt: null };
  }

  if (responseType.type === 'choose') {
    responseType.choices.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
    const raw = (await rl.question('  Pick number: ')).trim();
    const idx = Number(raw) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= responseType.choices.length) {
      console.log('  Not a valid choice.');
      return null;
    }
    return {
      status: 'modified',
      notes: null,
      responseData: { chosen: responseType.choices[idx] },
      executeAt: null,
    };
  }

  if (responseType.type === 'schedule') {
    const when = (await rl.question('  Execute at (ISO 8601, or blank for now): ')).trim();
    if (!when || when.toLowerCase() === 'now') {
      return { status: 'approved', notes: null, responseData: null, executeAt: null };
    }
    const parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) {
      console.log('  Not a valid ISO 8601 timestamp.');
      return null;
    }
    return { status: 'scheduled', notes: null, responseData: null, executeAt: parsed.toISOString() };
  }

  if (responseType.type === 'file_upload') {
    console.log('  File upload not supported in dev mode — treating as approved.');
    return { status: 'approved', notes: null, responseData: null, executeAt: null };
  }

  return { status: 'modified', notes: null, responseData: null, executeAt: null };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function devId(): string {
  return `dev_${Math.random().toString(36).slice(2, 14)}`;
}
