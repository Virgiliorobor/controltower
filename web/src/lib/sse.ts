// SSE-over-POST reader for the interview (ai-gateway/routes.ts). The interview start + turn endpoints stream
// text/event-stream frames in response to a POST body — EventSource can only GET, so we POST with fetch and
// parse the frames off the response body stream ourselves. Frames the server sends:
//   event: delta  data: { text }          ← streamed assistant text deltas (the agent "typing")
//   event: done   data: { draft_id?, assistant_message, is_complete }
//   event: error  data: { message }
// Relative path only (Rule 1); credentials:'include' carries the session cookie.

export interface InterviewDoneFrame {
  draft_id?: string;
  assistant_message: string;
  is_complete: boolean;
}

export interface InterviewStreamHandlers {
  onDelta?: (text: string) => void;
  onDone?: (frame: InterviewDoneFrame) => void;
  onError?: (message: string) => void;
}

const API_BASE = '/api/v1';

// Start an interview: POST /interviews, stream the first question. Resolves with the final done frame.
export function startInterviewStream(
  body: { seed?: { title_es?: string; domain?: string } | null; language?: 'es' | 'en' },
  handlers: InterviewStreamHandlers,
  signal?: AbortSignal,
): Promise<InterviewDoneFrame> {
  return streamPost(`${API_BASE}/interviews`, body, handlers, signal);
}

// Submit a turn: POST /interviews/:draftId/turns, stream the next question.
export function submitTurnStream(
  draftId: string,
  answer: string,
  handlers: InterviewStreamHandlers,
  signal?: AbortSignal,
): Promise<InterviewDoneFrame> {
  return streamPost(`${API_BASE}/interviews/${draftId}/turns`, { answer }, handlers, signal);
}

async function streamPost(
  url: string,
  body: unknown,
  handlers: InterviewStreamHandlers,
  signal?: AbortSignal,
): Promise<InterviewDoneFrame> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    // The route may answer a non-2xx (e.g. 401/403) as JSON before opening the stream.
    let message = `interview_request_failed_${response.status}`;
    try {
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as { message?: string }) : null;
      if (parsed?.message) message = parsed.message;
    } catch {
      /* keep the status-based message */
    }
    handlers.onError?.(message);
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneFrame: InterviewDoneFrame | null = null;

  const dispatch = (eventName: string, dataRaw: string): void => {
    let data: unknown = null;
    try {
      data = dataRaw ? JSON.parse(dataRaw) : null;
    } catch {
      return;
    }
    if (eventName === 'delta') {
      const text = (data as { text?: string })?.text ?? '';
      if (text) handlers.onDelta?.(text);
    } else if (eventName === 'done') {
      doneFrame = data as InterviewDoneFrame;
      handlers.onDone?.(doneFrame);
    } else if (eventName === 'error') {
      handlers.onError?.((data as { message?: string })?.message ?? 'interview_stream_error');
    }
  };

  // Parse the SSE wire format: blocks separated by a blank line; each block has `event:` and `data:` lines.
  const flushBlock = (block: string): void => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length > 0) dispatch(eventName, dataLines.join('\n'));
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) flushBlock(block);
      sep = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) flushBlock(buffer);

  if (!doneFrame) {
    const message = 'interview_stream_incomplete';
    handlers.onError?.(message);
    throw new Error(message);
  }
  return doneFrame;
}
