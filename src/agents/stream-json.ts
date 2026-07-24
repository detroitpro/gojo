/**
 * Incremental NDJSON line parser for Cursor/Claude stream-json stdout.
 */
export class NdjsonLineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines: string[] = [];
    while (true) {
      const idx = this.pending.indexOf('\n');
      if (idx < 0) {
        break;
      }
      const line = this.pending.slice(0, idx).trim();
      this.pending = this.pending.slice(idx + 1);
      if (line.length > 0) {
        lines.push(line);
      }
    }
    return lines;
  }

  flush(): string[] {
    const line = this.pending.trim();
    this.pending = '';
    return line.length > 0 ? [line] : [];
  }
}

export type AgentStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; phase: 'started' | 'completed'; callId: string; name: string }
  | { kind: 'model'; model: string }
  | { kind: 'result'; payload: Record<string, unknown> };

function toolNameFromPayload(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== 'object') {
    return 'tool';
  }
  const obj = toolCall as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.endsWith('ToolCall') || key.endsWith('Tool')) {
      return key.replace(/ToolCall$/, '').replace(/Tool$/, '');
    }
  }
  const fn = obj['function'];
  if (fn && typeof fn === 'object') {
    const name = (fn as { name?: string }).name;
    if (name) {
      return name;
    }
  }
  return 'tool';
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
      const text = (item as { text?: string }).text;
      if (typeof text === 'string' && text.length > 0) {
        parts.push(text);
      }
    }
  }
  return parts.join('');
}

/**
 * Turn Cursor `--stream-partial-output` assistant payloads into printable
 * deltas. Handles both incremental tokens and cumulative snapshots without
 * forcing a newline after every piece (that made the agent console
 * word-wrap vertically).
 */
export function resolveAssistantTextDelta(
  previouslyEmitted: string,
  incoming: string,
): { emit: string; nextPrevious: string } | null {
  if (!incoming) {
    return null;
  }
  if (incoming === previouslyEmitted) {
    return null;
  }
  if (previouslyEmitted && incoming.startsWith(previouslyEmitted)) {
    return {
      emit: incoming.slice(previouslyEmitted.length),
      nextPrevious: incoming,
    };
  }
  if (previouslyEmitted && previouslyEmitted.startsWith(incoming)) {
    // Shorter prefix / rewind — ignore.
    return null;
  }
  // Fresh delta token (or a new segment after a tool call).
  return {
    emit: incoming,
    nextPrevious: previouslyEmitted + incoming,
  };
}

/**
 * Map a Cursor stream-json event object into gojo stream events.
 * Filters duplicate assistant flushes when stream-partial-output is used.
 */
export function mapCursorStreamEvent(raw: unknown): AgentStreamEvent[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const event = raw as Record<string, unknown>;
  const type = event['type'];

  if (type === 'system' && event['subtype'] === 'init' && typeof event['model'] === 'string') {
    return [{ kind: 'model', model: event['model'] }];
  }

  if (type === 'assistant') {
    // Skip duplicate buffered flushes (see Cursor stream-json docs).
    if (event['model_call_id'] != null) {
      return [];
    }
    const text = assistantText(event['message']);
    return text ? [{ kind: 'text', text }] : [];
  }

  if (type === 'tool_call') {
    const phase = event['subtype'] === 'completed' ? 'completed' : 'started';
    const callId = typeof event['call_id'] === 'string' ? event['call_id'] : 'unknown';
    return [
      {
        kind: 'tool',
        phase,
        callId,
        name: toolNameFromPayload(event['tool_call']),
      },
    ];
  }

  if (type === 'result') {
    return [{ kind: 'result', payload: event }];
  }

  return [];
}
