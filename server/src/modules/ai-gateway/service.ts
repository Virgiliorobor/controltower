// ai-gateway service (B8/B9) — the bus↔ICM adapter. Hosts the AI layer (00_orchestrator routing +
// 01_process_interview + 02_sop_freshness + the deterministic Draft Validator) and owns process_drafts,
// freshness_reports, ai_runs.
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ THE AI WRITE-PATH BOUNDARY (Rule 7, architecture_spec §2/§8, connection_map human_review_gate):       │
// │ This service NEVER writes the process-registry tables and NEVER emits a registry-write/publish event.  │
// │ It produces a process_draft (interview) or a freshness_report (suggestions). The ONLY path a draft     │
// │ becomes a published process is: ai-gateway emits interview.draft_ready → the SPA renders Draft Review  │
// │ → an editor clicks Save → the SPA calls process-registry's publish/create routes. There is no call or  │
// │ event from here into the registry. Grep this file: it imports no registry service and emits no         │
// │ process.*/step.*/handoff.* events.                                                                     │
// └─────────────────────────────────────────────────────────────────────────────────────────────────────┘

import type { AiRunKind, ProcessDraft as ProcessDraftRow } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import type { SettingsService } from '../platform-core/settings.js';
import { IcmClient, type RunUsage, type StreamSink } from './icm/client.js';
import {
  INTERVIEW_SYSTEM_PROMPT,
  FRESHNESS_SYSTEM_PROMPT,
  firstInterviewUserMessage,
  turnUserMessage,
  freshnessUserMessage,
} from './icm/prompts.js';
import type { ProcessDraft } from './icm/schemas.js';
import { applyBlankAndFlag, detectViolations } from './validator.js';

const SOURCE_NODE = 'ai-gateway';

interface TranscriptEntry {
  role: 'agent' | 'editor';
  text: string;
  at: string;
}

export interface ActorMeta {
  actorId?: string;
  sessionId?: string;
}

export class AiGatewayService {
  private readonly icm: IcmClient;

  constructor(
    private readonly ctx: AppContext,
    private readonly settings: SettingsService,
    // A read-only snapshot compiler from the registry. Passed in (not imported) so this module never holds a
    // registry write surface — it can only READ a snapshot to scan, never write. The boundary stays explicit.
    private readonly snapshotProvider: (processId: string) => Promise<unknown>,
  ) {
    this.icm = new IcmClient(ctx.config, ctx.logger);
  }

  // ---------------------------------------------------------------------------------------------------------
  // INTERVIEW (B8). start → emits interview.started; submit-turn streams the next question; finish validates.
  // ---------------------------------------------------------------------------------------------------------

  // Start: create a process_draft (status in_interview), emit interview.started, run the first turn (the
  // greeting + first question), stream it to the client, persist the partial draft + transcript + run log.
  async startInterview(
    seed: { title_es?: string; domain?: string } | null,
    language: 'es' | 'en',
    meta: ActorMeta,
    sink?: StreamSink,
  ): Promise<{ draftId: string; assistant_message: string; is_complete: boolean }> {
    const row = await this.ctx.db.processDraft.create({
      data: {
        status: 'in_interview',
        language,
        editor_id: meta.actorId ?? null,
        process_seed: (seed ?? null) as Prisma.InputJsonValue,
        draft: {} as Prisma.InputJsonValue,
        events: [] as unknown as Prisma.InputJsonValue,
      },
    });

    await this.ctx.bus.emit('interview.started', { draft_id: row.id, language, actor_id: meta.actorId }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'user.action' },
    });

    const userMessage = firstInterviewUserMessage(seed, language);
    const result = await this.icm.interviewTurn(INTERVIEW_SYSTEM_PROMPT, userMessage, sink);
    await this.recordRun(row.id, null, 'interview_turn', result.usage);

    const transcript: TranscriptEntry[] = [{ role: 'agent', text: result.output.assistant_message, at: new Date().toISOString() }];
    await this.persistTurn(row.id, result.output.draft ?? null, transcript, result.usage, 'interview_turn');

    await this.ctx.bus.emit('interview.prompt_ready', { draft_id: row.id, is_complete: result.output.is_complete }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'interview.started' },
    });

    return { draftId: row.id, assistant_message: result.output.assistant_message, is_complete: result.output.is_complete };
  }

  // Submit-turn: append the editor's answer, run the next turn (streamed), persist, emit interview.prompt_ready.
  async submitTurn(
    draftId: string,
    answer: string,
    meta: ActorMeta,
    sink?: StreamSink,
  ): Promise<{ assistant_message: string; is_complete: boolean }> {
    const row = await this.loadDraft(draftId);
    if (row.status !== 'in_interview') {
      throw new ValidationError('Interview is already finished (status ready_for_review)');
    }

    await this.ctx.bus.emit('interview.turn_submitted', { draft_id: draftId, actor_id: meta.actorId }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'user.action' },
    });

    const transcript = this.readTranscript(row);
    transcript.push({ role: 'editor', text: answer, at: new Date().toISOString() });

    const userMessage = turnUserMessage(
      transcript.map((t) => ({ role: t.role, text: t.text })),
      answer,
      (row.draft as unknown) ?? {},
    );
    const result = await this.icm.interviewTurn(INTERVIEW_SYSTEM_PROMPT, userMessage, sink);

    transcript.push({ role: 'agent', text: result.output.assistant_message, at: new Date().toISOString() });
    await this.persistTurn(draftId, result.output.draft ?? (row.draft as unknown as ProcessDraft), transcript, result.usage, 'interview_turn');

    await this.ctx.bus.emit('interview.prompt_ready', { draft_id: draftId, is_complete: result.output.is_complete }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'interview.turn_submitted' },
    });

    // If the agent signalled completion, finish automatically (validate + emit draft_ready).
    if (result.output.is_complete) {
      await this.finishInterview(draftId, meta);
    }
    return { assistant_message: result.output.assistant_message, is_complete: result.output.is_complete };
  }

  // Finish: take the assembled draft, run the deterministic Draft Validator. On HARD violations: regenerate
  // the draft ONCE (a fresh model turn naming the violations); if it still fails → blank-and-flag. Then persist
  // status=ready_for_review and emit interview.draft_ready (with the validation result). NEVER publishes.
  async finishInterview(draftId: string, meta: ActorMeta): Promise<{ status: string; passed: boolean }> {
    const row = await this.loadDraft(draftId);
    let draft = (row.draft as unknown as ProcessDraft) ?? { process: { title_es: '' }, steps: [] };
    if (!draft.process || !Array.isArray(draft.steps)) {
      throw new ValidationError('Draft has no assembled process/steps to validate');
    }

    let violations = detectViolations(draft);
    let regenerated = false;
    const hardViolations = violations.filter((v) => v.hard);

    // Regenerate ONCE if there are hard violations, naming them so the model can self-correct.
    if (hardViolations.length > 0) {
      regenerated = true;
      const transcript = this.readTranscript(row);
      const namedViolations = hardViolations.map((v) => `- ${v.field}: ${v.detail}`).join('\n');
      const regenMessage = [
        'El borrador tiene violaciones de validación que debes corregir SIN inventar datos.',
        'Violaciones:',
        namedViolations,
        '',
        'BORRADOR ACTUAL (JSON):',
        JSON.stringify(draft, null, 0),
        '',
        'Devuelve el borrador corregido. Si no tienes el dato real para un campo, déjalo vacío (no lo inventes);',
        'marca is_complete=true.',
      ].join('\n');
      try {
        const regen = await this.icm.interviewTurn(INTERVIEW_SYSTEM_PROMPT, regenMessage);
        await this.recordRun(draftId, null, 'interview_finish', regen.usage);
        if (regen.output.draft) {
          draft = regen.output.draft;
          violations = detectViolations(draft);
        }
      } catch (error) {
        this.ctx.logger.warn({ err: error, draftId }, 'regenerate-once failed; proceeding to blank-and-flag');
      }
    }

    // Whatever remains: blank-and-flag the bad fields. NEVER auto-fill, NEVER publish.
    const validation = applyBlankAndFlag(draft, violations);

    await this.ctx.db.processDraft.update({
      where: { id: draftId },
      data: {
        status: 'ready_for_review',
        draft: validation.draft as unknown as Prisma.InputJsonValue,
        coverage_gaps: validation.coverage_gaps as unknown as Prisma.InputJsonValue,
        confidence_flags: validation.confidence_flags as unknown as Prisma.InputJsonValue,
      },
    });

    await this.ctx.bus.emit(
      'interview.draft_ready',
      {
        draft_id: draftId,
        passed: validation.passed,
        regenerated,
        blanked_fields: validation.confidence_flags.filter((f) => violations.find((v) => v.field === f.field && v.hard)).map((f) => f.field),
        actor_id: meta.actorId,
      },
      { source_node: SOURCE_NODE, metadata: { session_id: meta.sessionId, triggered_by: 'interview.turn_submitted' } },
    );

    return { status: 'ready_for_review', passed: validation.passed };
  }

  // The current draft for Draft Review (the SPA renders this; an editor edits + Saves it via the registry).
  async getDraft(draftId: string): Promise<{
    draft: unknown;
    status: string;
    coverage_gaps: unknown;
    confidence_flags: unknown;
    published_process_id: string | null;
  }> {
    const row = await this.loadDraft(draftId);
    return {
      draft: row.draft,
      status: row.status,
      coverage_gaps: row.coverage_gaps,
      confidence_flags: row.confidence_flags,
      published_process_id: row.published_process_id,
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // FRESHNESS (B9). Scan a stored process for stale/owner-gap/missing-doc steps → freshness_report. SUGGESTION
  // ONLY — never edits. Callable from the route AND from the platform-core scheduler event.
  // ---------------------------------------------------------------------------------------------------------

  async runFreshnessScan(processId: string, trigger: 'scheduled' | 'editor_opened', meta: ActorMeta = {}): Promise<string> {
    const snapshot = await this.snapshotProvider(processId); // READ-only registry snapshot (no write surface)
    const s = await this.settings.get();
    const today = new Date().toISOString().slice(0, 10);
    const userMessage = freshnessUserMessage(snapshot, today, { stale_days: s.stale_days, soon_days: s.soon_days }, trigger);

    const result = await this.icm.freshnessScan(FRESHNESS_SYSTEM_PROMPT, userMessage);
    await this.recordRun(null, processId, 'freshness_scan', result.usage);

    const report = await this.ctx.db.freshnessReport.create({
      data: {
        process_id: processId,
        trigger,
        flags: result.output.flags as unknown as Prisma.InputJsonValue,
        suggested_edits: result.output.suggested_edits as unknown as Prisma.InputJsonValue,
        summary_es: result.output.summary_es,
        summary_en: result.output.summary_en,
      },
    });

    await this.ctx.bus.emit(
      'freshness.report_ready',
      { report_id: report.id, process_id: processId, flag_count: result.output.flags.length },
      { source_node: SOURCE_NODE, metadata: { session_id: meta.sessionId, triggered_by: `freshness.scan_requested:${trigger}` } },
    );
    return report.id;
  }

  async latestFreshnessReport(processId: string): Promise<unknown> {
    const report = await this.ctx.db.freshnessReport.findFirst({
      where: { process_id: processId },
      orderBy: { scanned_at: 'desc' },
    });
    if (!report) throw new NotFoundError('No freshness report for this process yet');
    return report;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------------------------------------

  private async loadDraft(id: string): Promise<ProcessDraftRow> {
    const row = await this.ctx.db.processDraft.findUnique({ where: { id } });
    if (!row || row.is_archived) throw new NotFoundError('Draft not found');
    return row;
  }

  private readTranscript(row: ProcessDraftRow): TranscriptEntry[] {
    const events = (row.events as unknown as { transcript?: TranscriptEntry[] }) ?? {};
    return Array.isArray(events.transcript) ? events.transcript : [];
  }

  private async persistTurn(
    draftId: string,
    draft: ProcessDraft | null,
    transcript: TranscriptEntry[],
    usage: RunUsage,
    action: AiRunKind,
  ): Promise<void> {
    const row = await this.loadDraft(draftId);
    const events = (row.events as unknown as { transcript?: TranscriptEntry[]; runs?: unknown[] }) ?? {};
    const runs = Array.isArray(events.runs) ? events.runs : [];
    runs.push({ at: new Date().toISOString(), actor: '01_process_interview', action, ...usage });
    await this.ctx.db.processDraft.update({
      where: { id: draftId },
      data: {
        ...(draft ? { draft: draft as unknown as Prisma.InputJsonValue } : {}),
        events: { transcript, runs } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ai_runs row per model call (model, tokens if available, latency, status) — the observability/cost surface.
  private async recordRun(draftId: string | null, processId: string | null, kind: AiRunKind, usage: RunUsage): Promise<void> {
    await this.ctx.db.aiRun.create({
      data: {
        kind,
        draft_id: draftId,
        process_id: processId,
        model: usage.model,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
        latency_ms: usage.latency_ms,
      },
    });
  }
}
