// process-registry service (B3) — THE single writer of the live map.
// Owns: processes, steps, handoffs, responsible_parties, io_items, step_io, step_documents.
// Responsibilities: full CRUD; sequence ordering; branch/loop/parallel edges with bilingual condition
// enforcement; the DERIVED rag_status (recomputed on every step write, persisted denormalized); the human
// publish (Save) action; a GRAPH read for the React Flow map and a full step-detail read for the wiki.
//
// BOUNDARY (Rule 7 / architecture_spec §2): the AI layer is NEVER in a write path here. ai-gateway produces
// a draft; only an editor's Save calls publishProcess() / the create/update methods on this service via the
// /api/v1 routes. There is NO event or call path from ai-gateway into this service. The link from a draft to
// the registry is a human action (Draft Review → Save), realised as ordinary authenticated route calls.
//
// All cross-module signalling is via the bus (Rule 4): this service emits process.*/step.*/handoff.*/party.*/
// io_item.* events and consumes documents' file.uploaded (the registry owns the step↔document link).

import type {
  Confidence,
  Classification,
  Handoff,
  HandoffKind,
  IoKind,
  PartyKind,
  Prisma,
  Process,
  ResponsibleParty,
  Step,
  StepDocumentRole,
  StepIoRole,
  StepType,
} from '@prisma/client';
import type { AppContext } from '../../core/context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import type { SettingsService } from '../platform-core/settings.js';
import { computeRagStatus, type RagStepInput, type RagThresholds } from './rag.js';

const SOURCE_NODE = 'process-registry';

// ---------------------------------------------------------------------------------------------------------
// Input shapes (validated at the route boundary with zod; typed here for the service surface).
// ---------------------------------------------------------------------------------------------------------

export interface ActorMeta {
  actorId?: string;
  sessionId?: string;
}

export interface CreateProcessInput {
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  domain?: string | null;
  language_default?: 'es' | 'en';
}

export interface UpdateProcessInput {
  title_es?: string;
  title_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  domain?: string | null;
  overall_owner_party_id?: string | null;
  language_default?: 'es' | 'en';
}

export interface CreateStepInput {
  sequence_index?: number; // optional → appended after the current max
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  trigger_es?: string | null;
  trigger_en?: string | null;
  action_es?: string | null;
  action_en?: string | null;
  reason_es?: string | null;
  reason_en?: string | null;
  step_type?: StepType | null;
  classification?: Classification | null;
  confidence?: Confidence;
  common_issues_es?: string | null;
  common_issues_en?: string | null;
  responsible_party_id?: string | null;
}

export type UpdateStepInput = Partial<CreateStepInput>;

export interface CreateHandoffInput {
  process_id: string;
  from_step_id: string;
  to_step_id: string;
  kind: HandoffKind;
  condition_es?: string | null;
  condition_en?: string | null;
}

export type UpdateHandoffInput = Partial<Pick<CreateHandoffInput, 'kind' | 'condition_es' | 'condition_en'>>;

export interface CreatePartyInput {
  name: string;
  role?: string | null;
  email?: string | null;
  organization?: string | null;
  party_kind: PartyKind;
  user_id?: string | null;
  key_person_risk?: boolean;
  backup_noted?: boolean;
  notes_es?: string | null;
  notes_en?: string | null;
}

export type UpdatePartyInput = Partial<CreatePartyInput>;

export interface CreateIoItemInput {
  name_es: string;
  name_en?: string | null;
  kind: IoKind;
  description_es?: string | null;
  description_en?: string | null;
}

// ---------------------------------------------------------------------------------------------------------
// WHOLE-GRAPH SAVE (MAJ-01 / MAJ-02). The shape the editor's single human Save sends from Draft Review or
// Form Create. Client-local ids ("ref" strings) wire the graph together; the service resolves them to real
// uuids inside one transaction. A party ref either reuses an existing party (by uuid) or creates a new one
// from the captured contact. This is the HUMAN's Save — it lives here in process-registry (the single
// writer); ai-gateway never calls it and is never in this path (the draft is read on the CLIENT and the
// already-reviewed graph is posted here by an authenticated editor).
// ---------------------------------------------------------------------------------------------------------

export interface SaveGraphPartyInput {
  ref: string; // client-local id used to wire steps/process owner to this party
  existing_party_id?: string | null; // reuse a directory party by uuid (dedupe) — else create from the fields
  name: string;
  role?: string | null;
  email?: string | null;
  organization?: string | null;
  party_kind: PartyKind;
  key_person_risk?: boolean;
  backup_noted?: boolean;
  notes_es?: string | null;
  notes_en?: string | null;
}

export interface SaveGraphIoItemInput {
  ref: string; // client-local id used by step_io to point at this io_item
  name_es: string;
  name_en?: string | null;
  kind: IoKind;
  description_es?: string | null;
  description_en?: string | null;
}

export interface SaveGraphStepIoInput {
  io_ref: string; // → SaveGraphIoItemInput.ref
  role: StepIoRole;
}

export interface SaveGraphStepDocumentInput {
  document_id: string; // an already-uploaded document (documents module owns the bytes)
  role: StepDocumentRole;
}

export interface SaveGraphStepInput {
  ref: string; // client-local id used by handoffs to point at this step
  sequence_index: number;
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  trigger_es?: string | null;
  trigger_en?: string | null;
  action_es?: string | null;
  action_en?: string | null;
  reason_es?: string | null;
  reason_en?: string | null;
  step_type?: StepType | null;
  classification?: Classification | null;
  confidence?: Confidence;
  common_issues_es?: string | null;
  common_issues_en?: string | null;
  responsible_party_ref?: string | null; // → SaveGraphPartyInput.ref (resolved to responsible_party_id)
  io?: SaveGraphStepIoInput[];
  documents?: SaveGraphStepDocumentInput[];
}

export interface SaveGraphHandoffInput {
  from_step_ref: string; // → SaveGraphStepInput.ref
  to_step_ref: string; // → SaveGraphStepInput.ref
  kind: HandoffKind;
  condition_es?: string | null;
  condition_en?: string | null;
}

export interface SaveProcessGraphInput {
  process: CreateProcessInput & { overall_owner_party_ref?: string | null };
  parties?: SaveGraphPartyInput[];
  io_items?: SaveGraphIoItemInput[];
  steps: SaveGraphStepInput[];
  handoffs?: SaveGraphHandoffInput[];
  publish?: boolean; // true → go live (status=active) after persisting; false → stay draft
}

export class ProcessRegistryService {
  constructor(
    private readonly ctx: AppContext,
    private readonly settings: SettingsService,
  ) {}

  // -------------------------------------------------------------------------------------------------------
  // RAG: assemble the rule input from a persisted step + its links, compute, and persist denormalized.
  // Called on EVERY write that can change a step's health.
  // -------------------------------------------------------------------------------------------------------

  private async thresholds(): Promise<RagThresholds> {
    const s = await this.settings.get();
    return { stale_days: s.stale_days, soon_days: s.soon_days };
  }

  // Recompute rag_status for a single step id. Returns the new status. Pure rule lives in rag.ts.
  async recomputeStepRag(stepId: string, thresholds?: RagThresholds): Promise<void> {
    const step = await this.ctx.db.step.findUnique({
      where: { id: stepId },
      include: {
        responsible_party: true,
        step_documents: true,
        handoffs_out: { where: { is_archived: false } },
      },
    });
    if (!step || step.is_archived) return;

    const t = thresholds ?? (await this.thresholds());

    // A dangling handoff (a to_step that is archived/missing) is a structural break.
    let structuralBreak = false;
    for (const h of step.handoffs_out) {
      const target = await this.ctx.db.step.findUnique({ where: { id: h.to_step_id } });
      if (!target || target.is_archived) {
        structuralBreak = true;
        break;
      }
    }

    const owner = step.responsible_party;
    const input: RagStepInput = {
      has_owner: Boolean(step.responsible_party_id),
      has_contact_email: Boolean(owner?.email),
      owner_required: true,
      contact_required: true,
      // A step with at least one document attached counts as "docs present"; a step with none is treated as
      // not-yet-documented (soft amber), never red on docs alone (an operator decides relevance).
      required_docs_present: step.step_documents.length > 0,
      missing_en_gloss: !step.title_en,
      has_structural_break: structuralBreak,
      last_reviewed_at: step.last_reviewed_at,
    };

    const rag = computeRagStatus(input, t);
    if (rag !== step.rag_status) {
      await this.ctx.db.step.update({ where: { id: stepId }, data: { rag_status: rag } });
    }
  }

  // Recompute every non-archived step of a process (used after structural changes / reorder / publish).
  async recomputeProcessRag(processId: string): Promise<void> {
    const t = await this.thresholds();
    const steps = await this.ctx.db.step.findMany({
      where: { process_id: processId, is_archived: false },
      select: { id: true },
    });
    for (const s of steps) {
      await this.recomputeStepRag(s.id, t);
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // PROCESS lifecycle
  // -------------------------------------------------------------------------------------------------------

  async listProcesses(filters: {
    status?: 'draft' | 'active' | 'archived';
    has_unowned?: boolean;
  } = {}): Promise<Process[]> {
    const where: Prisma.ProcessWhereInput = { is_archived: false };
    if (filters.status) where.status = filters.status;
    const processes = await this.ctx.db.process.findMany({ where, orderBy: { created_at: 'desc' } });
    if (!filters.has_unowned) return processes;
    // Filter to processes that contain at least one step with no responsible party (a health signal).
    const result: Process[] = [];
    for (const p of processes) {
      const unowned = await this.ctx.db.step.count({
        where: { process_id: p.id, is_archived: false, responsible_party_id: null },
      });
      if (unowned > 0) result.push(p);
    }
    return result;
  }

  async getProcess(id: string): Promise<Process> {
    const process = await this.ctx.db.process.findUnique({ where: { id } });
    if (!process || process.is_archived) throw new NotFoundError('Process not found');
    return process;
  }

  async createProcess(input: CreateProcessInput, meta: ActorMeta): Promise<Process> {
    if (!input.title_es?.trim()) throw new ValidationError('title_es is required');
    const process = await this.ctx.db.process.create({
      data: {
        title_es: input.title_es,
        title_en: input.title_en ?? null,
        description_es: input.description_es ?? null,
        description_en: input.description_en ?? null,
        domain: input.domain ?? undefined,
        language_default: input.language_default ?? this.ctx.config.DEFAULT_LOCALE,
        status: 'draft',
        created_by: meta.actorId ?? null,
        updated_by: meta.actorId ?? null,
      },
    });
    await this.emit('process.created', { id: process.id, title_es: process.title_es }, meta);
    return process;
  }

  async updateProcess(id: string, patch: UpdateProcessInput, meta: ActorMeta): Promise<Process> {
    await this.getProcess(id);
    if (patch.overall_owner_party_id) {
      await this.assertParty(patch.overall_owner_party_id);
    }
    const data: Prisma.ProcessUpdateInput = { updated_by_user: meta.actorId ? { connect: { id: meta.actorId } } : undefined };
    if (patch.title_es !== undefined) data.title_es = patch.title_es;
    if (patch.title_en !== undefined) data.title_en = patch.title_en;
    if (patch.description_es !== undefined) data.description_es = patch.description_es;
    if (patch.description_en !== undefined) data.description_en = patch.description_en;
    if (patch.domain !== undefined) data.domain = patch.domain;
    if (patch.language_default !== undefined) data.language_default = patch.language_default;
    if (patch.overall_owner_party_id !== undefined) {
      data.overall_owner = patch.overall_owner_party_id
        ? { connect: { id: patch.overall_owner_party_id } }
        : { disconnect: true };
    }
    const process = await this.ctx.db.process.update({ where: { id }, data });
    await this.emit('process.updated', { id: process.id }, meta);
    return process;
  }

  // THE human Save → active. This is the only path a draft's content becomes a live, published process.
  // The AI never calls this; an editor's Save (a route call) does. publish = process.published on the bus.
  async publishProcess(id: string, meta: ActorMeta): Promise<Process> {
    const process = await this.getProcess(id);
    const stepCount = await this.ctx.db.step.count({ where: { process_id: id, is_archived: false } });
    if (stepCount === 0) throw new ValidationError('Cannot publish a process with no steps');
    // Re-validate structure before going live: branch/loop edges must carry condition_es (defense in depth;
    // the DB CHECK enforces it too).
    await this.assertHandoffConditions(id);
    const published = await this.ctx.db.process.update({
      where: { id },
      data: { status: 'active', updated_by: meta.actorId ?? null },
    });
    await this.recomputeProcessRag(id);
    await this.emit('process.published', { id: published.id, status: published.status }, meta);
    return published;
  }

  async archiveProcess(id: string, meta: ActorMeta): Promise<Process> {
    await this.getProcess(id);
    const process = await this.ctx.db.process.update({
      where: { id },
      data: { is_archived: true, status: 'archived', updated_by: meta.actorId ?? null },
    });
    await this.emit('process.archived', { id: process.id }, meta);
    return process;
  }

  // -------------------------------------------------------------------------------------------------------
  // WHOLE-GRAPH SAVE (MAJ-01 / MAJ-02) — the human's single Save of a complete process.
  //
  // Persists the WHOLE captured graph atomically: process header + responsible_parties (reuse-or-create) +
  // io_items + ordered steps (with per-step responsible_party_id) + step_io links + step_documents +
  // handoffs (bilingual branch/loop conditions). Used by BOTH creation paths (Draft Review save and Form
  // Create save) so neither one silently drops owners / IO / documents again.
  //
  // BOUNDARY (Rule 7 / architecture_spec §2): this is the HUMAN's Save. It is role-guarded (editor/admin) at
  // the route and called from the SPA by an editor. ai-gateway does NOT call it and is NOT in this path — the
  // draft is an ai-gateway artifact read on the CLIENT; the editor reviews/edits it and posts the resulting
  // graph here, to process-registry (the single writer). There is no event or call path from ai-gateway into
  // this method.
  //
  // Order of operations: (1) validate ALL references up front (bad ref → 400, never a silent drop);
  // (2) one transaction writes header→parties→io→steps→links→handoffs and (optionally) flips to active;
  // (3) AFTER commit, recompute derived RAG and emit lifecycle events on the bus.
  async saveProcessGraph(input: SaveProcessGraphInput, meta: ActorMeta): Promise<Process> {
    if (!input.process?.title_es?.trim()) throw new ValidationError('process.title_es is required');
    if (!input.steps || input.steps.length === 0) throw new ValidationError('A process must have at least one step');

    const parties = input.parties ?? [];
    const ioItems = input.io_items ?? [];
    const handoffs = input.handoffs ?? [];

    // --- Pre-flight reference validation (no writes yet; a bad ref returns a clear 400) ---------------
    const partyRefs = new Set(parties.map((p) => p.ref));
    if (partyRefs.size !== parties.length) throw new ValidationError('Duplicate party ref in save graph');
    const ioRefs = new Set(ioItems.map((i) => i.ref));
    if (ioRefs.size !== ioItems.length) throw new ValidationError('Duplicate io_item ref in save graph');
    const stepRefs = new Set(input.steps.map((s) => s.ref));
    if (stepRefs.size !== input.steps.length) throw new ValidationError('Duplicate step ref in save graph');

    const seqIndices = input.steps.map((s) => s.sequence_index);
    if (new Set(seqIndices).size !== seqIndices.length) {
      throw new ValidationError('Duplicate sequence_index across steps in save graph');
    }

    // Any existing party referenced for reuse must actually exist (and not be archived).
    for (const p of parties) {
      if (p.existing_party_id) await this.assertParty(p.existing_party_id);
      else if (!p.name?.trim()) throw new ValidationError(`Party ${p.ref} needs a name (or an existing_party_id)`);
    }
    if (input.process.overall_owner_party_ref && !partyRefs.has(input.process.overall_owner_party_ref)) {
      throw new ValidationError('process.overall_owner_party_ref does not reference a party in the graph');
    }
    for (const s of input.steps) {
      if (s.responsible_party_ref && !partyRefs.has(s.responsible_party_ref)) {
        throw new ValidationError(`Step ${s.ref} responsible_party_ref does not reference a party in the graph`);
      }
      for (const link of s.io ?? []) {
        if (!ioRefs.has(link.io_ref)) throw new ValidationError(`Step ${s.ref} io link references unknown io_ref ${link.io_ref}`);
      }
    }
    for (const h of handoffs) {
      if (!stepRefs.has(h.from_step_ref)) throw new ValidationError(`Handoff from_step_ref ${h.from_step_ref} is unknown`);
      if (!stepRefs.has(h.to_step_ref)) throw new ValidationError(`Handoff to_step_ref ${h.to_step_ref} is unknown`);
      this.assertCondition(h.kind, h.condition_es); // branch/loop must carry condition_es
    }
    // Validate that every referenced document exists before we open the transaction.
    const docIds = new Set<string>();
    for (const s of input.steps) for (const d of s.documents ?? []) docIds.add(d.document_id);
    for (const docId of docIds) {
      const doc = await this.ctx.db.document.findUnique({ where: { id: docId } });
      if (!doc || doc.is_archived) throw new ValidationError(`document_id ${docId} does not reference an existing document`);
    }

    const actorId = meta.actorId ?? null;

    // --- Atomic write: everything succeeds or nothing is written -------------------------------------
    const processId = await this.ctx.db.$transaction(async (tx) => {
      // 1) Parties — reuse an existing directory party (by uuid) or create a new one from the captured contact.
      const partyIdByRef = new Map<string, string>();
      for (const p of parties) {
        if (p.existing_party_id) {
          partyIdByRef.set(p.ref, p.existing_party_id);
          continue;
        }
        const created = await tx.responsibleParty.create({
          data: {
            name: p.name,
            role: p.role ?? null,
            email: p.email ?? null,
            organization: p.organization ?? null,
            party_kind: p.party_kind,
            key_person_risk: p.key_person_risk ?? false,
            backup_noted: p.backup_noted ?? false,
            notes_es: p.notes_es ?? null,
            notes_en: p.notes_en ?? null,
          },
        });
        partyIdByRef.set(p.ref, created.id);
      }

      // 2) Process header.
      const process = await tx.process.create({
        data: {
          title_es: input.process.title_es,
          title_en: input.process.title_en ?? null,
          description_es: input.process.description_es ?? null,
          description_en: input.process.description_en ?? null,
          domain: input.process.domain ?? undefined,
          language_default: input.process.language_default ?? this.ctx.config.DEFAULT_LOCALE,
          status: 'draft',
          overall_owner_party_id: input.process.overall_owner_party_ref
            ? partyIdByRef.get(input.process.overall_owner_party_ref) ?? null
            : null,
          created_by: actorId,
          updated_by: actorId,
        },
      });

      // 3) IO items.
      const ioIdByRef = new Map<string, string>();
      for (const item of ioItems) {
        const created = await tx.ioItem.create({
          data: {
            process_id: process.id,
            name_es: item.name_es,
            name_en: item.name_en ?? null,
            kind: item.kind,
            description_es: item.description_es ?? null,
            description_en: item.description_en ?? null,
          },
        });
        ioIdByRef.set(item.ref, created.id);
      }

      // 4) Steps (with per-step responsible_party_id) + their step_io and step_document links.
      const stepIdByRef = new Map<string, string>();
      for (const s of input.steps) {
        const created = await tx.step.create({
          data: {
            process_id: process.id,
            sequence_index: s.sequence_index,
            title_es: s.title_es,
            title_en: s.title_en ?? null,
            description_es: s.description_es ?? null,
            description_en: s.description_en ?? null,
            trigger_es: s.trigger_es ?? null,
            trigger_en: s.trigger_en ?? null,
            action_es: s.action_es ?? null,
            action_en: s.action_en ?? null,
            reason_es: s.reason_es ?? null,
            reason_en: s.reason_en ?? null,
            step_type: s.step_type ?? null,
            classification: s.classification ?? null,
            confidence: s.confidence ?? 'INFERRED',
            common_issues_es: s.common_issues_es ?? null,
            common_issues_en: s.common_issues_en ?? null,
            // per-step owner — the field MAJ-01 reported as dropped is persisted here.
            responsible_party_id: s.responsible_party_ref ? partyIdByRef.get(s.responsible_party_ref) ?? null : null,
            created_by: actorId,
            updated_by: actorId,
          },
        });
        stepIdByRef.set(s.ref, created.id);

        for (const link of s.io ?? []) {
          await tx.stepIo.create({
            data: { step_id: created.id, io_item_id: ioIdByRef.get(link.io_ref) as string, role: link.role },
          });
        }
        for (const d of s.documents ?? []) {
          await tx.stepDocument.create({
            data: { step_id: created.id, document_id: d.document_id, role: d.role },
          });
        }
      }

      // 5) Handoffs (edges; branch/loop conditions already validated above).
      for (const h of handoffs) {
        await tx.handoff.create({
          data: {
            process_id: process.id,
            from_step_id: stepIdByRef.get(h.from_step_ref) as string,
            to_step_id: stepIdByRef.get(h.to_step_ref) as string,
            kind: h.kind,
            condition_es: h.condition_es ?? null,
            condition_en: h.condition_en ?? null,
          },
        });
      }

      // 6) Optional publish → active, inside the same transaction so a partial save can never go live.
      if (input.publish) {
        await tx.process.update({ where: { id: process.id }, data: { status: 'active', updated_by: actorId } });
      }

      return process.id;
    });

    // --- Post-commit: derived RAG + lifecycle events (read fresh rows / hit the bus, never inside the tx).
    await this.recomputeProcessRag(processId);
    await this.emit('process.created', { id: processId, title_es: input.process.title_es }, meta);
    if (input.publish) {
      const published = await this.ctx.db.process.findUniqueOrThrow({ where: { id: processId } });
      await this.emit('process.published', { id: processId, status: published.status }, meta);
    }
    return this.getProcess(processId);
  }

  // -------------------------------------------------------------------------------------------------------
  // STEP lifecycle
  // -------------------------------------------------------------------------------------------------------

  async getStep(id: string): Promise<Step> {
    const step = await this.ctx.db.step.findUnique({ where: { id } });
    if (!step || step.is_archived) throw new NotFoundError('Step not found');
    return step;
  }

  async createStep(processId: string, input: CreateStepInput, meta: ActorMeta): Promise<Step> {
    await this.getProcess(processId);
    if (!input.title_es?.trim()) throw new ValidationError('title_es is required');
    if (input.responsible_party_id) await this.assertParty(input.responsible_party_id);

    const sequenceIndex = input.sequence_index ?? (await this.nextSequenceIndex(processId));
    await this.assertSequenceFree(processId, sequenceIndex);

    const step = await this.ctx.db.step.create({
      data: {
        process_id: processId,
        sequence_index: sequenceIndex,
        title_es: input.title_es,
        title_en: input.title_en ?? null,
        description_es: input.description_es ?? null,
        description_en: input.description_en ?? null,
        trigger_es: input.trigger_es ?? null,
        trigger_en: input.trigger_en ?? null,
        action_es: input.action_es ?? null,
        action_en: input.action_en ?? null,
        reason_es: input.reason_es ?? null,
        reason_en: input.reason_en ?? null,
        step_type: input.step_type ?? null,
        classification: input.classification ?? null,
        confidence: input.confidence ?? 'INFERRED',
        common_issues_es: input.common_issues_es ?? null,
        common_issues_en: input.common_issues_en ?? null,
        responsible_party_id: input.responsible_party_id ?? null,
        created_by: meta.actorId ?? null,
        updated_by: meta.actorId ?? null,
      },
    });
    await this.recomputeStepRag(step.id);
    await this.emit('step.created', { id: step.id, process_id: processId }, meta);
    return this.getStep(step.id);
  }

  async updateStep(id: string, patch: UpdateStepInput, meta: ActorMeta): Promise<Step> {
    const existing = await this.getStep(id);
    if (patch.responsible_party_id) await this.assertParty(patch.responsible_party_id);
    if (patch.sequence_index !== undefined && patch.sequence_index !== existing.sequence_index) {
      await this.assertSequenceFree(existing.process_id, patch.sequence_index, id);
    }

    const confidenceChanged = patch.confidence !== undefined && patch.confidence !== existing.confidence;

    const data: Prisma.StepUpdateInput = { updated_by_user: meta.actorId ? { connect: { id: meta.actorId } } : undefined };
    const fields: (keyof UpdateStepInput)[] = [
      'sequence_index', 'title_es', 'title_en', 'description_es', 'description_en', 'trigger_es', 'trigger_en',
      'action_es', 'action_en', 'reason_es', 'reason_en', 'step_type', 'classification', 'confidence',
      'common_issues_es', 'common_issues_en',
    ];
    for (const f of fields) {
      if (patch[f] !== undefined) (data as Record<string, unknown>)[f] = patch[f];
    }
    if (patch.responsible_party_id !== undefined) {
      data.responsible_party = patch.responsible_party_id
        ? { connect: { id: patch.responsible_party_id } }
        : { disconnect: true };
    }

    await this.ctx.db.step.update({ where: { id }, data });
    await this.recomputeStepRag(id);
    await this.emit('step.updated', { id, process_id: existing.process_id }, meta);
    if (confidenceChanged) {
      await this.emit('step.confidence_changed', { id, confidence: patch.confidence }, meta);
    }
    return this.getStep(id);
  }

  // Mark CONFIRMED — the seed-correction action. confidence is an orthogonal channel; it does NOT feed RAG.
  async confirmStep(id: string, meta: ActorMeta): Promise<Step> {
    const existing = await this.getStep(id);
    if (existing.confidence === 'CONFIRMED') return existing;
    await this.ctx.db.step.update({ where: { id }, data: { confidence: 'CONFIRMED', updated_by: meta.actorId ?? null } });
    await this.emit('step.confidence_changed', { id, confidence: 'CONFIRMED' }, meta);
    return this.getStep(id);
  }

  // Mark reviewed → last_reviewed_at = now → recompute rag (freshness is a RAG input).
  async reviewStep(id: string, meta: ActorMeta): Promise<Step> {
    await this.getStep(id);
    await this.ctx.db.step.update({ where: { id }, data: { last_reviewed_at: new Date(), updated_by: meta.actorId ?? null } });
    await this.recomputeStepRag(id);
    await this.emit('step.reviewed', { id }, meta);
    return this.getStep(id);
  }

  async archiveStep(id: string, meta: ActorMeta): Promise<Step> {
    const step = await this.getStep(id);
    await this.ctx.db.step.update({ where: { id }, data: { is_archived: true, updated_by: meta.actorId ?? null } });
    // Archiving a step can dangle handoffs to/from it → recompute neighbours' RAG.
    await this.recomputeProcessRag(step.process_id);
    await this.emit('step.archived', { id, process_id: step.process_id }, meta);
    return this.ctx.db.step.findUniqueOrThrow({ where: { id } });
  }

  // Bulk reorder: { step_id, sequence_index }[] applied atomically; re-validates uniqueness; recomputes RAG.
  async reorderSteps(processId: string, order: { step_id: string; sequence_index: number }[], meta: ActorMeta): Promise<void> {
    await this.getProcess(processId);
    const indices = order.map((o) => o.sequence_index);
    if (new Set(indices).size !== indices.length) {
      throw new ValidationError('Duplicate sequence_index values in reorder request');
    }
    // Two-phase to dodge the partial-unique collision: park everything in a high negative band, then set.
    await this.ctx.db.$transaction(async (tx) => {
      let parking = -1;
      for (const o of order) {
        await tx.step.update({ where: { id: o.step_id }, data: { sequence_index: parking } });
        parking -= 1;
      }
      for (const o of order) {
        await tx.step.update({ where: { id: o.step_id }, data: { sequence_index: o.sequence_index } });
      }
    });
    await this.recomputeProcessRag(processId);
    await this.emit('step.reordered', { process_id: processId, count: order.length }, meta);
  }

  // -------------------------------------------------------------------------------------------------------
  // HANDOFF lifecycle (edges; branch/loop require a bilingual condition — condition_es mandatory)
  // -------------------------------------------------------------------------------------------------------

  async createHandoff(input: CreateHandoffInput, meta: ActorMeta): Promise<Handoff> {
    await this.getProcess(input.process_id);
    const from = await this.getStep(input.from_step_id);
    const to = await this.getStep(input.to_step_id);
    if (from.process_id !== input.process_id || to.process_id !== input.process_id) {
      throw new ValidationError('from/to steps must belong to the process');
    }
    this.assertCondition(input.kind, input.condition_es);
    const handoff = await this.ctx.db.handoff.create({
      data: {
        process_id: input.process_id,
        from_step_id: input.from_step_id,
        to_step_id: input.to_step_id,
        kind: input.kind,
        condition_es: input.condition_es ?? null,
        condition_en: input.condition_en ?? null,
      },
    });
    await this.recomputeStepRag(input.from_step_id);
    await this.emit('handoff.created', { id: handoff.id, process_id: input.process_id }, meta);
    return handoff;
  }

  async updateHandoff(id: string, patch: UpdateHandoffInput, meta: ActorMeta): Promise<Handoff> {
    const existing = await this.ctx.db.handoff.findUnique({ where: { id } });
    if (!existing || existing.is_archived) throw new NotFoundError('Handoff not found');
    const nextKind = patch.kind ?? existing.kind;
    const nextConditionEs = patch.condition_es !== undefined ? patch.condition_es : existing.condition_es;
    this.assertCondition(nextKind, nextConditionEs);
    const data: Prisma.HandoffUpdateInput = {};
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.condition_es !== undefined) data.condition_es = patch.condition_es;
    if (patch.condition_en !== undefined) data.condition_en = patch.condition_en;
    const handoff = await this.ctx.db.handoff.update({ where: { id }, data });
    await this.emit('handoff.updated', { id, process_id: existing.process_id }, meta);
    return handoff;
  }

  async archiveHandoff(id: string, meta: ActorMeta): Promise<Handoff> {
    const existing = await this.ctx.db.handoff.findUnique({ where: { id } });
    if (!existing || existing.is_archived) throw new NotFoundError('Handoff not found');
    const handoff = await this.ctx.db.handoff.update({ where: { id }, data: { is_archived: true } });
    await this.recomputeStepRag(existing.from_step_id);
    await this.emit('handoff.archived', { id, process_id: existing.process_id }, meta);
    return handoff;
  }

  // -------------------------------------------------------------------------------------------------------
  // RESPONSIBLE PARTY directory (CRUD + contact name/email/role)
  // -------------------------------------------------------------------------------------------------------

  async listParties(): Promise<ResponsibleParty[]> {
    return this.ctx.db.responsibleParty.findMany({ where: { is_archived: false }, orderBy: { name: 'asc' } });
  }

  async getParty(id: string): Promise<ResponsibleParty> {
    const party = await this.ctx.db.responsibleParty.findUnique({ where: { id } });
    if (!party || party.is_archived) throw new NotFoundError('Party not found');
    return party;
  }

  async createParty(input: CreatePartyInput, meta: ActorMeta): Promise<ResponsibleParty> {
    if (!input.name?.trim()) throw new ValidationError('name is required');
    const party = await this.ctx.db.responsibleParty.create({
      data: {
        name: input.name,
        role: input.role ?? null,
        email: input.email ?? null,
        organization: input.organization ?? null,
        party_kind: input.party_kind,
        user_id: input.user_id ?? null,
        key_person_risk: input.key_person_risk ?? false,
        backup_noted: input.backup_noted ?? false,
        notes_es: input.notes_es ?? null,
        notes_en: input.notes_en ?? null,
      },
    });
    await this.emit('party.created', { id: party.id, name: party.name }, meta);
    return party;
  }

  async updateParty(id: string, patch: UpdatePartyInput, meta: ActorMeta): Promise<ResponsibleParty> {
    await this.getParty(id);
    const data: Prisma.ResponsiblePartyUpdateInput = {};
    const fields: (keyof UpdatePartyInput)[] = [
      'name', 'role', 'email', 'organization', 'party_kind', 'user_id', 'key_person_risk', 'backup_noted', 'notes_es', 'notes_en',
    ];
    for (const f of fields) {
      if (patch[f] !== undefined) (data as Record<string, unknown>)[f] = patch[f];
    }
    const party = await this.ctx.db.responsibleParty.update({ where: { id }, data });
    await this.emit('party.updated', { id: party.id }, meta);
    // A contact (email) change can flip a step's RAG → recompute every step this party owns.
    await this.recomputePartySteps(id);
    return party;
  }

  async archiveParty(id: string, meta: ActorMeta): Promise<ResponsibleParty> {
    await this.getParty(id);
    const party = await this.ctx.db.responsibleParty.update({ where: { id }, data: { is_archived: true } });
    await this.emit('party.archived', { id: party.id }, meta);
    return party;
  }

  // -------------------------------------------------------------------------------------------------------
  // IO ITEMS + step_io links (the output→input chain modelling)
  // -------------------------------------------------------------------------------------------------------

  async listIoItems(processId: string): Promise<unknown[]> {
    await this.getProcess(processId);
    return this.ctx.db.ioItem.findMany({ where: { process_id: processId, is_archived: false }, orderBy: { created_at: 'asc' } });
  }

  async createIoItem(processId: string, input: CreateIoItemInput, meta: ActorMeta): Promise<unknown> {
    await this.getProcess(processId);
    if (!input.name_es?.trim()) throw new ValidationError('name_es is required');
    const item = await this.ctx.db.ioItem.create({
      data: {
        process_id: processId,
        name_es: input.name_es,
        name_en: input.name_en ?? null,
        kind: input.kind,
        description_es: input.description_es ?? null,
        description_en: input.description_en ?? null,
      },
    });
    await this.emit('io_item.created', { id: item.id, process_id: processId }, meta);
    return item;
  }

  async linkStepIo(stepId: string, ioItemId: string, role: StepIoRole, meta: ActorMeta): Promise<void> {
    await this.getStep(stepId);
    const item = await this.ctx.db.ioItem.findUnique({ where: { id: ioItemId } });
    if (!item || item.is_archived) throw new NotFoundError('IO item not found');
    await this.ctx.db.stepIo.upsert({
      where: { step_id_io_item_id_role: { step_id: stepId, io_item_id: ioItemId, role } },
      create: { step_id: stepId, io_item_id: ioItemId, role },
      update: {},
    });
    await this.emit('step.io_linked', { step_id: stepId, io_item_id: ioItemId, role }, meta);
  }

  async unlinkStepIo(stepId: string, ioItemId: string, role: StepIoRole, meta: ActorMeta): Promise<void> {
    await this.ctx.db.stepIo.deleteMany({ where: { step_id: stepId, io_item_id: ioItemId, role } });
    await this.emit('step.io_unlinked', { step_id: stepId, io_item_id: ioItemId, role }, meta);
  }

  // -------------------------------------------------------------------------------------------------------
  // STEP ↔ DOCUMENT links. The registry OWNS this join; documents owns the bytes/metadata. The AI never
  // sets a file_ref or attaches a doc — only this method (driven by an editor route) creates the link.
  // -------------------------------------------------------------------------------------------------------

  async linkStepDocument(stepId: string, documentId: string, role: StepDocumentRole, meta: ActorMeta): Promise<void> {
    await this.getStep(stepId);
    const doc = await this.ctx.db.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.is_archived) throw new NotFoundError('Document not found');
    await this.ctx.db.stepDocument.upsert({
      where: { step_id_document_id_role: { step_id: stepId, document_id: documentId, role } },
      create: { step_id: stepId, document_id: documentId, role },
      update: {},
    });
    await this.recomputeStepRag(stepId); // attaching a doc can flip amber→green
    await this.emit('step.document_linked', { step_id: stepId, document_id: documentId, role }, meta);
  }

  async unlinkStepDocument(stepId: string, documentId: string, role: StepDocumentRole, meta: ActorMeta): Promise<void> {
    await this.ctx.db.stepDocument.deleteMany({ where: { step_id: stepId, document_id: documentId, role } });
    await this.recomputeStepRag(stepId);
    await this.emit('step.document_unlinked', { step_id: stepId, document_id: documentId, role }, meta);
  }

  async listStepDocuments(stepId: string): Promise<unknown[]> {
    await this.getStep(stepId);
    return this.ctx.db.stepDocument.findMany({
      where: { step_id: stepId },
      include: { document: true },
    });
  }

  // -------------------------------------------------------------------------------------------------------
  // READ MODELS
  // -------------------------------------------------------------------------------------------------------

  // GRAPH read for the React Flow map: nodes = steps (with derived rag + confidence + owner/gap + doc counts),
  // edges = handoffs (with kind + bilingual condition). architecture_spec §4 GET /processes/:id/map.
  async getProcessGraph(id: string): Promise<{
    process: Process;
    overall_owner: ResponsibleParty | null;
    nodes: unknown[];
    edges: unknown[];
  }> {
    const process = await this.getProcess(id);
    const steps = await this.ctx.db.step.findMany({
      where: { process_id: id, is_archived: false },
      orderBy: { sequence_index: 'asc' },
      include: {
        responsible_party: true,
        step_documents: true,
        step_io: { include: { io_item: true } },
      },
    });
    const handoffs = await this.ctx.db.handoff.findMany({
      where: { process_id: id, is_archived: false },
    });

    const nodes = steps.map((s) => ({
      id: s.id,
      sequence_index: s.sequence_index,
      title_es: s.title_es,
      title_en: s.title_en,
      step_type: s.step_type,
      classification: s.classification,
      confidence: s.confidence, // operator-trust channel
      rag_status: s.rag_status, // derived-health channel
      last_reviewed_at: s.last_reviewed_at,
      owner: s.responsible_party
        ? { id: s.responsible_party.id, name: s.responsible_party.name, email: s.responsible_party.email, key_person_risk: s.responsible_party.key_person_risk }
        : null, // null → a gap chip on the node, never an invented owner
      has_owner_gap: !s.responsible_party_id,
      document_count: s.step_documents.length,
      input_count: s.step_io.filter((l) => l.role === 'input').length,
      output_count: s.step_io.filter((l) => l.role === 'output').length,
    }));

    const overallOwner = process.overall_owner_party_id
      ? await this.ctx.db.responsibleParty.findUnique({ where: { id: process.overall_owner_party_id } })
      : null;

    const edges = handoffs.map((h) => ({
      id: h.id,
      from_step_id: h.from_step_id,
      to_step_id: h.to_step_id,
      kind: h.kind, // sequential | branch | loop | parallel — drawn distinctly by the map
      condition_es: h.condition_es,
      condition_en: h.condition_en,
    }));

    return { process, overall_owner: overallOwner, nodes, edges };
  }

  // Full step-detail read for the wiki: every field + inputs/outputs + owner + documents + handoffs-out.
  async getStepDetail(id: string): Promise<unknown> {
    const step = await this.ctx.db.step.findUnique({
      where: { id },
      include: {
        responsible_party: true,
        process: { select: { id: true, title_es: true, title_en: true } },
        step_io: { include: { io_item: true } },
        step_documents: { include: { document: true } },
        handoffs_out: { where: { is_archived: false } },
        handoffs_in: { where: { is_archived: false } },
      },
    });
    if (!step || step.is_archived) throw new NotFoundError('Step not found');
    return {
      ...step,
      inputs: step.step_io.filter((l) => l.role === 'input').map((l) => l.io_item),
      outputs: step.step_io.filter((l) => l.role === 'output').map((l) => l.io_item),
      documents: step.step_documents.map((sd) => ({ role: sd.role, document: sd.document })),
    };
  }

  // Compile a process snapshot for a freshness scan (called from the freshness route / event). Read-only.
  // This is what app-core hands the ICM freshness specialist — it never writes anything.
  async compileSnapshot(id: string): Promise<unknown> {
    const graph = await this.getProcessGraph(id);
    const steps = await this.ctx.db.step.findMany({
      where: { process_id: id, is_archived: false },
      orderBy: { sequence_index: 'asc' },
      include: {
        responsible_party: true,
        step_documents: { include: { document: true } },
      },
    });
    return {
      process: { id: graph.process.id, title_es: graph.process.title_es, title_en: graph.process.title_en, domain: graph.process.domain },
      steps: steps.map((s) => ({
        id: s.id,
        sequence_index: s.sequence_index,
        title_es: s.title_es,
        title_en: s.title_en,
        action_es: s.action_es,
        last_reviewed_at: s.last_reviewed_at,
        rag_status: s.rag_status,
        responsible_party: s.responsible_party
          ? {
              id: s.responsible_party.id,
              name: s.responsible_party.name,
              email: s.responsible_party.email,
              key_person_risk: s.responsible_party.key_person_risk,
              backup_noted: s.responsible_party.backup_noted,
            }
          : null,
        documents: s.step_documents.map((sd) => ({ doc_type: sd.document.doc_type, name: sd.document.name, role: sd.role })),
      })),
      handoffs: graph.edges,
    };
  }

  // -------------------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------------------

  private async nextSequenceIndex(processId: string): Promise<number> {
    const max = await this.ctx.db.step.aggregate({
      where: { process_id: processId, is_archived: false },
      _max: { sequence_index: true },
    });
    return (max._max.sequence_index ?? 0) + 1;
  }

  private async assertSequenceFree(processId: string, sequenceIndex: number, exceptStepId?: string): Promise<void> {
    const clash = await this.ctx.db.step.findFirst({
      where: {
        process_id: processId,
        sequence_index: sequenceIndex,
        is_archived: false,
        ...(exceptStepId ? { id: { not: exceptStepId } } : {}),
      },
    });
    if (clash) throw new ConflictError(`sequence_index ${sequenceIndex} already in use`);
  }

  private async assertParty(id: string): Promise<void> {
    const party = await this.ctx.db.responsibleParty.findUnique({ where: { id } });
    if (!party || party.is_archived) throw new ValidationError('responsible_party_id does not reference an existing party');
  }

  private assertCondition(kind: HandoffKind, conditionEs: string | null | undefined): void {
    if ((kind === 'branch' || kind === 'loop') && !conditionEs?.trim()) {
      throw new ValidationError(`A ${kind} handoff requires condition_es (a branch/loop without a condition is meaningless)`);
    }
  }

  private async assertHandoffConditions(processId: string): Promise<void> {
    const offenders = await this.ctx.db.handoff.findMany({
      where: { process_id: processId, is_archived: false, kind: { in: ['branch', 'loop'] }, condition_es: null },
    });
    if (offenders.length > 0) {
      throw new ValidationError('All branch/loop handoffs must carry condition_es before publish');
    }
  }

  private async recomputePartySteps(partyId: string): Promise<void> {
    const t = await this.thresholds();
    const steps = await this.ctx.db.step.findMany({
      where: { responsible_party_id: partyId, is_archived: false },
      select: { id: true },
    });
    for (const s of steps) await this.recomputeStepRag(s.id, t);
  }

  private async emit(
    eventType: Parameters<AppContext['bus']['emit']>[0],
    payload: Record<string, unknown>,
    meta: ActorMeta,
  ): Promise<void> {
    await this.ctx.bus.emit(eventType, { actor_id: meta.actorId, ...payload }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'user.action' },
    });
  }
}
