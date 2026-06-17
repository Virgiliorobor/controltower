// Anthropic SDK wrapper for the two ICM specialists (server-side only — the key is a Coolify env secret,
// never in the SPA). Model ids come from env (build-config per models.yaml): INTERVIEW_MODEL
// (claude-opus-4-8) and FRESHNESS_MODEL (claude-haiku-4-5). A model swap is an env change, nothing else.
//
// STRUCTURED OUTPUT: models.yaml asks for `json_schema` structured output. The installed @anthropic-ai/sdk
// (0.69) exposes structured output as forced TOOL USE — a single tool whose input_schema IS the target schema,
// pinned with tool_choice:{type:'tool',name}. That is the SDK-supported, equivalent mechanism: the model must
// emit exactly one tool_use block whose `input` conforms to the schema, which we read as the structured result.
// When the SDK gains first-class `output_config.format`, this is the one place to swap (the schemas are reused
// verbatim). We deliberately do NOT use assistant prefill (removed on Opus 4.7+).
//
// THINKING: models.yaml asks for adaptive thinking on the interview. The installed SDK exposes
// `thinking:{type:'enabled',budget_tokens}` (adaptive isn't in this SDK version). We enable thinking on the
// interview with a generous budget for the intelligence-sensitive NL→structure mapping. NOTE: thinking +
// forced tool_choice are mutually exclusive on the API, so the interview runs WITHOUT the budget when a tool
// is forced; we therefore keep the structured contract (forced tool) and rely on the strong model — the
// spec's "effort: high" intent is met by model choice (opus-4-8). Freshness runs small + non-streaming on Haiku.
//
// Interview = STREAMING (avoids HTTP timeouts; the SPA renders the streamed question over SSE). Freshness =
// non-streaming (small 2048-token response). Every call returns usage so the service writes an ai_runs row.
//
// GUARD (no crash-on-import): the client is constructed lazily on first call; ANTHROPIC_API_KEY is validated
// at startup by the zod config loader, so by the time we reach a call the key is present.

import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../../../core/config.js';
import type { Logger } from '../../../core/logger.js';
import {
  INTERVIEW_TURN_SCHEMA,
  FRESHNESS_REPORT_SCHEMA,
  type InterviewTurnOutput,
  type FreshnessReportOutput,
} from './schemas.js';

const INTERVIEW_TURN_TOOL = 'emit_interview_turn';
const FRESHNESS_REPORT_TOOL = 'emit_freshness_report';

export interface RunUsage {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  latency_ms: number;
  status: 'ok' | 'error';
}

export interface InterviewTurnResult {
  output: InterviewTurnOutput;
  usage: RunUsage;
}

export interface FreshnessResult {
  output: FreshnessReportOutput;
  usage: RunUsage;
}

// A sink the route uses to forward streamed assistant text to the SSE client as it arrives.
export type StreamSink = (deltaText: string) => void;

export class IcmClient {
  private client: Anthropic | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  private sdk(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.config.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  // One interview turn. Streams assistant text to `sink` (when provided) and returns the final structured
  // turn output (assistant_message + is_complete + partial draft) plus usage.
  async interviewTurn(
    systemPrompt: string,
    userMessage: string,
    sink?: StreamSink,
  ): Promise<InterviewTurnResult> {
    const started = Date.now();
    const stream = this.sdk().messages.stream({
      model: this.config.INTERVIEW_MODEL, // claude-opus-4-8 (build-config; swap via env)
      max_tokens: 16000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: INTERVIEW_TURN_TOOL,
          description:
            'Emit the next interview turn as structured data: the single next Spanish-first question (or the closing message), whether the interview is complete, and the accumulated process_draft.',
          input_schema: INTERVIEW_TURN_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      // Force the structured tool so the model returns exactly the turn shape (SDK-supported structured output).
      tool_choice: { type: 'tool', name: INTERVIEW_TURN_TOOL },
      messages: [{ role: 'user', content: userMessage }],
    });

    if (sink) {
      // Forward the streamed tool-input JSON deltas to the SSE client (the live "agent is composing" signal).
      // With forced tool use the assistant text rides in the tool input; we stream the raw input_json deltas so
      // the client sees progress, and the service sends the parsed assistant_message in the final SSE frame.
      stream.on('inputJson', (delta: string) => {
        if (!delta) return;
        try {
          sink(delta);
        } catch (err) {
          this.logger.warn({ err }, 'interview SSE sink failed');
        }
      });
    }

    const message = await stream.finalMessage();
    const usage = this.usageFrom(message, this.config.INTERVIEW_MODEL, started);
    const output = this.parseToolInput<InterviewTurnOutput>(message, INTERVIEW_TURN_TOOL);
    return { output, usage };
  }

  // One freshness scan. Non-streaming, small output, forced structured tool. Haiku 4.5 — no thinking, no effort.
  async freshnessScan(systemPrompt: string, userMessage: string): Promise<FreshnessResult> {
    const started = Date.now();
    const message = await this.sdk().messages.create({
      model: this.config.FRESHNESS_MODEL, // claude-haiku-4-5 (build-config; swap via env)
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: FRESHNESS_REPORT_TOOL,
          description: 'Emit the freshness report as structured data: flags, suggested_edits, and a bilingual summary.',
          input_schema: FRESHNESS_REPORT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: FRESHNESS_REPORT_TOOL },
      messages: [{ role: 'user', content: userMessage }],
    });

    const usage = this.usageFrom(message, this.config.FRESHNESS_MODEL, started);
    const output = this.parseToolInput<FreshnessReportOutput>(message, FRESHNESS_REPORT_TOOL);
    return { output, usage };
  }

  // Read the forced tool_use block's input (the structured result) from the message.
  private parseToolInput<T>(message: Anthropic.Message, toolName: string): T {
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName,
    );
    if (!block) {
      throw new Error(`Model returned no ${toolName} tool_use block for structured output`);
    }
    return block.input as T;
  }

  private usageFrom(message: Anthropic.Message, model: string, startedAt: number): RunUsage {
    const u = message.usage;
    return {
      model,
      input_tokens: u?.input_tokens ?? undefined,
      output_tokens: u?.output_tokens ?? undefined,
      cache_read_input_tokens: u?.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: u?.cache_creation_input_tokens ?? undefined,
      latency_ms: Date.now() - startedAt,
      status: 'ok',
    };
  }
}
