// process-registry HTTP routes under /api/v1 (architecture_spec §4). All writes are editor/admin only
// (requireRole); reads are open to any authenticated role (viewers are read-only). Inputs validated at the
// boundary with zod. request.session carries the authenticated user (set by auth.attachSession).
//
// SAVE GATE: POST /processes/:id/publish is the human Save. The AI never calls it; an editor does. There is
// no route here that lets ai-gateway write — the only writers are these authenticated, role-guarded handlers.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import type { ActorMeta, ProcessRegistryService } from './service.js';

const langEnum = z.enum(['es', 'en']);
const stepTypeEnum = z.enum(['TRANSFORMATION', 'VERIFICATION', 'ROUTING', 'COMMUNICATION', 'DOCUMENTATION']);
const classificationEnum = z.enum(['CRITICAL', 'AUTOMATABLE', 'REPETITIVE', 'CANDIDATE_FOR_REMOVAL']);
const confidenceEnum = z.enum(['CONFIRMED', 'INFERRED', 'FLAGGED']);
const handoffKindEnum = z.enum(['sequential', 'branch', 'loop', 'parallel']);
const partyKindEnum = z.enum(['internal_editor', 'internal_viewer', 'external']);
const ioKindEnum = z.enum(['information', 'material']);
const stepIoRoleEnum = z.enum(['input', 'output']);
const stepDocRoleEnum = z.enum(['consumes', 'produces', 'references']);

const idParam = z.object({ id: z.string().uuid() });

const createProcessSchema = z.object({
  title_es: z.string().min(1),
  title_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  language_default: langEnum.optional(),
});

const updateProcessSchema = z.object({
  title_es: z.string().min(1).optional(),
  title_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  overall_owner_party_id: z.string().uuid().nullable().optional(),
  language_default: langEnum.optional(),
});

const stepBodyBase = {
  sequence_index: z.number().int().positive().optional(),
  title_es: z.string().min(1),
  title_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  trigger_es: z.string().nullable().optional(),
  trigger_en: z.string().nullable().optional(),
  action_es: z.string().nullable().optional(),
  action_en: z.string().nullable().optional(),
  reason_es: z.string().nullable().optional(),
  reason_en: z.string().nullable().optional(),
  step_type: stepTypeEnum.nullable().optional(),
  classification: classificationEnum.nullable().optional(),
  confidence: confidenceEnum.optional(),
  common_issues_es: z.string().nullable().optional(),
  common_issues_en: z.string().nullable().optional(),
  responsible_party_id: z.string().uuid().nullable().optional(),
};
const createStepSchema = z.object(stepBodyBase);
const updateStepSchema = z.object({ ...stepBodyBase, title_es: z.string().min(1).optional() }).partial();

const createHandoffSchema = z.object({
  process_id: z.string().uuid(),
  from_step_id: z.string().uuid(),
  to_step_id: z.string().uuid(),
  kind: handoffKindEnum,
  condition_es: z.string().nullable().optional(),
  condition_en: z.string().nullable().optional(),
});
const updateHandoffSchema = z.object({
  kind: handoffKindEnum.optional(),
  condition_es: z.string().nullable().optional(),
  condition_en: z.string().nullable().optional(),
});

const partyBody = {
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  organization: z.string().nullable().optional(),
  party_kind: partyKindEnum,
  user_id: z.string().uuid().nullable().optional(),
  key_person_risk: z.boolean().optional(),
  backup_noted: z.boolean().optional(),
  notes_es: z.string().nullable().optional(),
  notes_en: z.string().nullable().optional(),
};
const createPartySchema = z.object(partyBody);
const updatePartySchema = z.object({ ...partyBody, name: z.string().min(1).optional(), party_kind: partyKindEnum.optional() }).partial();

const createIoSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().nullable().optional(),
  kind: ioKindEnum,
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
});

const reorderSchema = z.object({
  order: z.array(z.object({ step_id: z.string().uuid(), sequence_index: z.number().int().positive() })).min(1),
});

// --- Whole-graph Save (MAJ-01 / MAJ-02). The human's single Save of a complete process. ref strings are
// client-local ids that wire the graph together; the service resolves them to uuids inside one transaction.
const saveGraphPartySchema = z.object({
  ref: z.string().min(1),
  existing_party_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  organization: z.string().nullable().optional(),
  party_kind: partyKindEnum,
  key_person_risk: z.boolean().optional(),
  backup_noted: z.boolean().optional(),
  notes_es: z.string().nullable().optional(),
  notes_en: z.string().nullable().optional(),
});
const saveGraphIoItemSchema = z.object({
  ref: z.string().min(1),
  name_es: z.string().min(1),
  name_en: z.string().nullable().optional(),
  kind: ioKindEnum,
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
});
const saveGraphStepSchema = z.object({
  ref: z.string().min(1),
  sequence_index: z.number().int().positive(),
  title_es: z.string().min(1),
  title_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  trigger_es: z.string().nullable().optional(),
  trigger_en: z.string().nullable().optional(),
  action_es: z.string().nullable().optional(),
  action_en: z.string().nullable().optional(),
  reason_es: z.string().nullable().optional(),
  reason_en: z.string().nullable().optional(),
  step_type: stepTypeEnum.nullable().optional(),
  classification: classificationEnum.nullable().optional(),
  confidence: confidenceEnum.optional(),
  common_issues_es: z.string().nullable().optional(),
  common_issues_en: z.string().nullable().optional(),
  responsible_party_ref: z.string().nullable().optional(),
  io: z.array(z.object({ io_ref: z.string().min(1), role: stepIoRoleEnum })).optional(),
  documents: z.array(z.object({ document_id: z.string().uuid(), role: stepDocRoleEnum })).optional(),
});
const saveGraphHandoffSchema = z.object({
  from_step_ref: z.string().min(1),
  to_step_ref: z.string().min(1),
  kind: handoffKindEnum,
  condition_es: z.string().nullable().optional(),
  condition_en: z.string().nullable().optional(),
});
const saveGraphSchema = z.object({
  process: createProcessSchema.extend({ overall_owner_party_ref: z.string().nullable().optional() }),
  parties: z.array(saveGraphPartySchema).optional(),
  io_items: z.array(saveGraphIoItemSchema).optional(),
  steps: z.array(saveGraphStepSchema).min(1),
  handoffs: z.array(saveGraphHandoffSchema).optional(),
  publish: z.boolean().optional(),
});

export function registerProcessRegistryRoutes(
  app: FastifyInstance,
  _ctx: AppContext,
  deps: { auth: AuthMiddleware; service: ProcessRegistryService },
): void {
  const { auth, service } = deps;
  const editor = { preHandler: auth.requireRole('editor', 'admin') };
  const anyAuth = { preHandler: auth.requireAuth };

  const meta = (req: { session: { user: { id: string }; session_id: string } | null }): ActorMeta => ({
    actorId: req.session?.user.id,
    sessionId: req.session?.session_id,
  });

  // --- Processes ---
  app.get('/api/v1/processes', anyAuth, async (request) => {
    const q = z.object({
      status: z.enum(['draft', 'active', 'archived']).optional(),
      has_unowned: z.coerce.boolean().optional(),
    }).parse(request.query);
    return { processes: await service.listProcesses(q) };
  });

  app.post('/api/v1/processes', editor, async (request) => {
    const body = createProcessSchema.parse(request.body);
    return { process: await service.createProcess(body, meta(request)) };
  });

  app.get('/api/v1/processes/:id', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { process: await service.getProcess(id) };
  });

  app.patch('/api/v1/processes/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updateProcessSchema.parse(request.body);
    return { process: await service.updateProcess(id, body, meta(request)) };
  });

  app.post('/api/v1/processes/:id/publish', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { process: await service.publishProcess(id, meta(request)) };
  });

  // WHOLE-GRAPH SAVE (MAJ-01 / MAJ-02): the human's single Save of a complete process graph (header + parties
  // + io_items + ordered steps with per-step owner + step_io + step_documents + handoffs), persisted in one
  // transaction. Used by BOTH Draft Review (interview path) and Form Create.
  //
  // AI BOUNDARY (Rule 7): this is an editor's Save, role-guarded (editor/admin) and living in process-registry
  // (the single writer). ai-gateway NEVER calls this — the draft is an ai-gateway artifact the editor reviews
  // on the client; the reviewed graph is posted here by the authenticated human. There is no call/event path
  // from ai-gateway into this route. Bad references return a clear 400 (ValidationError), never a silent drop.
  app.post('/api/v1/processes/save-graph', editor, async (request) => {
    const body = saveGraphSchema.parse(request.body);
    return { process: await service.saveProcessGraph(body, meta(request)) };
  });

  app.post('/api/v1/processes/:id/archive', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { process: await service.archiveProcess(id, meta(request)) };
  });

  // GRAPH read for the map; full snapshot read.
  app.get('/api/v1/processes/:id/map', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return service.getProcessGraph(id);
  });

  app.get('/api/v1/processes/:id/snapshot', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { snapshot: await service.compileSnapshot(id) };
  });

  app.post('/api/v1/processes/:id/reorder', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = reorderSchema.parse(request.body);
    await service.reorderSteps(id, body.order, meta(request));
    return { ok: true };
  });

  // --- Steps ---
  app.post('/api/v1/processes/:id/steps', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = createStepSchema.parse(request.body);
    return { step: await service.createStep(id, body, meta(request)) };
  });

  app.get('/api/v1/steps/:id', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { step: await service.getStepDetail(id) };
  });

  app.patch('/api/v1/steps/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updateStepSchema.parse(request.body);
    return { step: await service.updateStep(id, body, meta(request)) };
  });

  app.post('/api/v1/steps/:id/archive', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { step: await service.archiveStep(id, meta(request)) };
  });

  app.post('/api/v1/steps/:id/review', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { step: await service.reviewStep(id, meta(request)) };
  });

  app.post('/api/v1/steps/:id/confirm', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { step: await service.confirmStep(id, meta(request)) };
  });

  // --- Handoffs ---
  app.post('/api/v1/handoffs', editor, async (request) => {
    const body = createHandoffSchema.parse(request.body);
    return { handoff: await service.createHandoff(body, meta(request)) };
  });

  app.patch('/api/v1/handoffs/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updateHandoffSchema.parse(request.body);
    return { handoff: await service.updateHandoff(id, body, meta(request)) };
  });

  app.delete('/api/v1/handoffs/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { handoff: await service.archiveHandoff(id, meta(request)) };
  });

  // --- Responsible parties (directory) ---
  app.get('/api/v1/parties', anyAuth, async () => {
    return { parties: await service.listParties() };
  });

  app.post('/api/v1/parties', editor, async (request) => {
    const body = createPartySchema.parse(request.body);
    return { party: await service.createParty(body, meta(request)) };
  });

  app.patch('/api/v1/parties/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updatePartySchema.parse(request.body);
    return { party: await service.updateParty(id, body, meta(request)) };
  });

  app.delete('/api/v1/parties/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    return { party: await service.archiveParty(id, meta(request)) };
  });

  // --- IO items + step_io links ---
  app.get('/api/v1/processes/:id/io-items', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { io_items: await service.listIoItems(id) };
  });

  app.post('/api/v1/processes/:id/io-items', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = createIoSchema.parse(request.body);
    return { io_item: await service.createIoItem(id, body, meta(request)) };
  });

  app.post('/api/v1/steps/:id/io', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ io_item_id: z.string().uuid(), role: stepIoRoleEnum }).parse(request.body);
    await service.linkStepIo(id, body.io_item_id, body.role, meta(request));
    return { ok: true };
  });

  app.delete('/api/v1/steps/:id/io', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ io_item_id: z.string().uuid(), role: stepIoRoleEnum }).parse(request.body);
    await service.unlinkStepIo(id, body.io_item_id, body.role, meta(request));
    return { ok: true };
  });

  // --- Step ↔ document links (registry owns the join; documents owns the bytes) ---
  app.get('/api/v1/steps/:id/documents', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { documents: await service.listStepDocuments(id) };
  });

  app.post('/api/v1/steps/:id/documents', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ document_id: z.string().uuid(), role: stepDocRoleEnum }).parse(request.body);
    await service.linkStepDocument(id, body.document_id, body.role, meta(request));
    return { ok: true };
  });

  app.delete('/api/v1/steps/:id/documents/:documentId', editor, async (request) => {
    const params = z.object({ id: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: stepDocRoleEnum }).parse(request.body ?? {});
    await service.unlinkStepDocument(params.id, params.documentId, body.role, meta(request));
    return { ok: true };
  });
}
