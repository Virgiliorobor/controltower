// ai-gateway HTTP routes under /api/v1 (architecture_spec §4). The request/stream surface that fronts the bus
// events. Interview routes are editor-only (viewers never invoke the AI layer — auth-rbac/data_model_rules);
// freshness scan + read are editor-only too (acting on nudges is an editor action).
//
// The interview's submit-turn STREAMS the next assistant question to the client via SSE (text/event-stream):
// the IcmClient streams text deltas to a sink that writes SSE `data:` frames; on completion we send a final
// frame with is_complete + a done marker. This is the streamed prompt the SPA renders as the agent typing.
//
// SAVE GATE: there is NO route here that writes the registry. The interview ends at interview.draft_ready;
// the editor reviews the draft (GET /interviews/:draftId) and Saves it by calling the process-registry routes.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import type { ActorMeta, AiGatewayService } from './service.js';
import type { StreamSink } from './icm/client.js';

const draftIdParam = z.object({ draftId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export function registerAiGatewayRoutes(
  app: FastifyInstance,
  _ctx: AppContext,
  deps: { auth: AuthMiddleware; service: AiGatewayService },
): void {
  const { auth, service } = deps;
  const editor = { preHandler: auth.requireRole('editor', 'admin') };

  const meta = (req: { session: { user: { id: string }; session_id: string } | null }): ActorMeta => ({
    actorId: req.session?.user.id,
    sessionId: req.session?.session_id,
  });

  // SSE helper: set headers, return a sink that writes text deltas as SSE frames.
  const openSse = (reply: FastifyReply): { sink: StreamSink; send: (event: string, data: unknown) => void; end: () => void } => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering so deltas flush promptly
    reply.raw.flushHeaders?.();
    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const sink: StreamSink = (delta) => send('delta', { text: delta });
    const end = (): void => {
      reply.raw.end();
    };
    return { sink, send, end };
  };

  // Start an interview → emits interview.started, streams the first question (SSE). Returns draft_id in a final
  // SSE frame. Body: { seed?: {title_es, domain}, language?: 'es'|'en' }.
  app.post('/api/v1/interviews', editor, async (request, reply) => {
    const body = z.object({
      seed: z.object({ title_es: z.string().optional(), domain: z.string().optional() }).nullable().optional(),
      language: z.enum(['es', 'en']).optional(),
    }).parse(request.body ?? {});

    const { sink, send, end } = openSse(reply);
    try {
      const result = await service.startInterview(body.seed ?? null, body.language ?? 'es', meta(request), sink);
      send('done', { draft_id: result.draftId, assistant_message: result.assistant_message, is_complete: result.is_complete });
    } catch (error) {
      request.log.error({ err: error }, 'interview start failed');
      send('error', { message: 'interview_start_failed' });
    } finally {
      end();
    }
    return reply;
  });

  // Submit a turn → emits interview.turn_submitted, STREAMS the next question (SSE). Body: { answer }.
  app.post('/api/v1/interviews/:draftId/turns', editor, async (request, reply) => {
    const { draftId } = draftIdParam.parse(request.params);
    const body = z.object({ answer: z.string().min(1) }).parse(request.body);

    const { sink, send, end } = openSse(reply);
    try {
      const result = await service.submitTurn(draftId, body.answer, meta(request), sink);
      send('done', { assistant_message: result.assistant_message, is_complete: result.is_complete });
    } catch (error) {
      request.log.error({ err: error }, 'interview turn failed');
      send('error', { message: 'interview_turn_failed' });
    } finally {
      end();
    }
    return reply;
  });

  // Finish explicitly (assemble + validate → interview.draft_ready). Non-streaming JSON.
  app.post('/api/v1/interviews/:draftId/finish', editor, async (request) => {
    const { draftId } = draftIdParam.parse(request.params);
    return service.finishInterview(draftId, meta(request));
  });

  // The current draft for Draft Review (the SAVE gate UI renders this; the editor saves via the registry).
  app.get('/api/v1/interviews/:draftId', editor, async (request) => {
    const { draftId } = draftIdParam.parse(request.params);
    return service.getDraft(draftId);
  });

  // Trigger a freshness scan of a stored process → freshness.scan_requested → report. Non-streaming JSON.
  app.post('/api/v1/processes/:id/freshness-scan', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const reportId = await service.runFreshnessScan(id, 'editor_opened', meta(request));
    return { report_id: reportId };
  });

  // The latest freshness report for a process (rendered as non-binding nudges).
  app.get('/api/v1/processes/:id/freshness', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { report: await service.latestFreshnessReport(id) };
  });
}
