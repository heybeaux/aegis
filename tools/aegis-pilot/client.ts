// Model clients for the Aegis pilot.
//
// The ONLY network egress in the whole pilot is LoopbackChatClient.complete(),
// which POSTs to `${baseUrl}/chat/completions` after validateLoopbackBaseUrl()
// has accepted the URL. Redirects are refused so a loopback server cannot
// bounce the request elsewhere.
import { createHash } from 'node:crypto';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  PilotAction,
  PilotModelClient,
  UsageSnapshot,
} from './types.ts';
import { getTask } from './fixtures.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);

export class LoopbackUrlError extends Error {}

/**
 * Accepts only http(s)://127.0.0.1[:port]/... or http(s)://[::1][:port]/...
 * `localhost` is rejected on purpose: it is a name, and name resolution is
 * outside this process's control.
 */
export function validateLoopbackBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LoopbackUrlError(`base URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LoopbackUrlError(`base URL must use http or https, got ${url.protocol}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new LoopbackUrlError(`base URL host must be 127.0.0.1 or [::1], got ${url.hostname}`);
  }
  if (url.username || url.password) {
    throw new LoopbackUrlError('base URL must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new LoopbackUrlError('base URL must not carry a query string or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export function extractUsage(raw: unknown): UsageSnapshot {
  const usage = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
  return {
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  };
}

export class LoopbackChatClient implements PilotModelClient {
  readonly kind = 'loopback_openai_compatible' as const;
  private readonly endpoint: URL;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; apiKey?: string; timeoutMs: number }) {
    this.endpoint = new URL('chat/completions', validateLoopbackBaseUrl(options.baseUrl));
    // Defense in depth: the resolved endpoint must still be loopback.
    validateLoopbackBaseUrl(this.endpoint.origin + '/');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  get endpointUrl(): string {
    return this.endpoint.href;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: request.model,
        seed: request.seed,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        messages: request.messages,
        tools: request.tools,
        tool_choice: 'required',
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`chat completion HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    let rawEnvelope: unknown;
    try {
      rawEnvelope = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`chat completion returned non-JSON body: ${text.slice(0, 200)}`);
    }
    const choice = (rawEnvelope as { choices?: Array<{ message?: ChatMessage; finish_reason?: string }> })?.choices?.[0];
    return {
      rawEnvelope,
      assistantMessage: choice?.message ?? { role: 'assistant', content: '' },
      usage: extractUsage(rawEnvelope),
      finishReason: choice?.finish_reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Deterministic scripted client for the self-test. No I/O of any kind.
// ---------------------------------------------------------------------------

export type ScriptPolicy = 'safe' | 'reckless';

function actionArgs(action: PilotAction): Record<string, unknown> {
  const { name: _name, ...args } = action;
  return args;
}

/**
 * Plays the fixture's scripted actions. Solo: whole script then Finish.
 * Team: agent A plays the first half then Handoff; agent B plays the rest then
 * Finish. A gate block does not change the script — the client simply moves on,
 * which is what makes false blocks visible as lost completions.
 */
export class ScriptedSelfTestClient implements PilotModelClient {
  readonly kind = 'scripted_selftest' as const;
  readonly calls: Array<{ model: string; role: string; taskId: string; arm: string; seed: number }> = [];
  private readonly failOn?: (request: CompletionRequest) => boolean;

  constructor(options: { failOn?: (request: CompletionRequest) => boolean } = {}) {
    this.failOn = options.failOn;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push({
      model: request.model,
      role: request.meta.role,
      taskId: request.meta.taskId,
      arm: request.meta.arm,
      seed: request.seed,
    });
    if (this.failOn?.(request)) throw new Error('scripted transport failure (self-test fault injection)');
    const policy: ScriptPolicy = request.model.includes('reckless') ? 'reckless' : 'safe';
    const script = getTask(request.meta.taskId).scripts[policy];
    const turn = request.messages.filter((m) => m.role === 'assistant').length;
    const split = Math.ceil(script.length / 2);
    let action: PilotAction;
    if (request.meta.role === 'solo') {
      action = script[turn] ?? { name: 'Finish', summary: `scripted ${policy} run complete` };
    } else if (request.meta.role === 'team_a_implementer') {
      action = turn < split ? script[turn]! : { name: 'Handoff', note: `agent A ran ${split} scripted step(s); remaining steps for B` };
    } else {
      action = script[split + turn] ?? { name: 'Finish', summary: `scripted ${policy} team run complete` };
    }
    const id = `call_${createHash('sha256').update(JSON.stringify([request.meta, turn])).digest('hex').slice(0, 12)}`;
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: action.name, arguments: JSON.stringify(actionArgs(action)) } }],
    };
    const promptChars = JSON.stringify(request.messages).length;
    const usage = { prompt_tokens: Math.ceil(promptChars / 4), completion_tokens: 24, total_tokens: Math.ceil(promptChars / 4) + 24 };
    const rawEnvelope = { id: `scripted-${id}`, object: 'chat.completion', choices: [{ index: 0, message: assistantMessage, finish_reason: 'tool_calls' }], usage };
    return { rawEnvelope, assistantMessage, usage: extractUsage(rawEnvelope), finishReason: 'tool_calls' };
  }
}
