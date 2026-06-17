// THE deterministic Draft Validator (orchestrator-owned, in-code — NOT an LLM call).
// Validates a process_draft against icm_spec/_catalog/data_model_rules.md before the draft leaves the AI layer.
// On violation the orchestration policy is: regenerate the offending part ONCE (handled by the service by
// re-running the model), then BLANK-AND-FLAG the bad fields. NEVER auto-fill, NEVER publish. (architecture
// spec §8 step 4; orchestrator rules.) This module only DETECTS and APPLIES blank-and-flag; the regenerate-once
// loop lives in the service so it can re-invoke the model.
//
// Checks (data_model_rules VALIDATOR CHECK LIST):
//   1. Each Step: sequence_index present + unique; title_es present; >=1 of inputs/outputs.
//   2. Each Handoff: from/to reference existing steps; branch/loop has a condition.
//   3. Each Step.responsible_party_id (if set): references an existing party.
//   4. Output->input chain: an output consumed by no later step → FLAG (not a hard fail).
//   5. Each Document: valid doc_type; >=1 canonical term; both terms if the term is a glossary term.
//   6. Bilingual completeness: any glossary term used has both ES and EN stored.
//
// Hard fails (1-3, 5) → blank-and-flag the offending field. Soft (4, 6) → flag only (no blanking).

import { GLOSSARY_TERMS } from './icm/glossary.js';
import type {
  ProcessDraft,
  DraftStep,
  DraftHandoff,
  DraftDocument,
} from './icm/schemas.js';

export interface ConfidenceFlag {
  field: string;
  reason: string;
}

export interface Violation {
  field: string;
  detail: string;
  hard: boolean; // hard → blank-and-flag; soft → flag only
}

export interface ValidationResult {
  passed: boolean;
  violations: Violation[];
  coverage_gaps: string[]; // human-readable fields the editor still must fill
  confidence_flags: ConfidenceFlag[]; // blanked/flagged fields
  draft: ProcessDraft; // possibly with offending fields blanked
}

const VALID_DOC_TYPES = new Set([
  'PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte', 'CertificateOfOrigin',
  'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa', 'GoodsReceipt', 'Expediente', 'Other',
]);

// Detect-only pass: returns violations without mutating. Used to decide whether a regenerate is warranted.
export function detectViolations(draft: ProcessDraft): Violation[] {
  const violations: Violation[] = [];
  const steps = draft.steps ?? [];
  const handoffs = draft.handoffs ?? [];
  const parties = draft.parties ?? [];
  const documents = draft.documents ?? [];

  const stepIds = new Set(steps.map((s) => s.id));
  const partyIds = new Set(parties.map((p) => p.id));

  // 1. Steps
  const seenSeq = new Set<number>();
  for (const step of steps) {
    const tag = `steps[${step.id}]`;
    if (step.sequence_index === undefined || step.sequence_index === null) {
      violations.push({ field: `${tag}.sequence_index`, detail: 'missing sequence_index', hard: true });
    } else if (seenSeq.has(step.sequence_index)) {
      violations.push({ field: `${tag}.sequence_index`, detail: `duplicate sequence_index ${step.sequence_index}`, hard: true });
    } else {
      seenSeq.add(step.sequence_index);
    }
    if (!step.title_es?.trim()) {
      violations.push({ field: `${tag}.title_es`, detail: 'title_es is required', hard: true });
    }
    const hasInputs = (step.inputs ?? []).length > 0;
    const hasOutputs = (step.outputs ?? []).length > 0;
    if (!hasInputs && !hasOutputs) {
      // A step that consumes and produces nothing is suspect → flag (soft, per the rule's "→ flag").
      violations.push({ field: `${tag}.inputs/outputs`, detail: 'step has no inputs or outputs', hard: false });
    }
    // 3. responsible_party_id reference integrity
    if (step.responsible_party_id && !partyIds.has(step.responsible_party_id)) {
      violations.push({ field: `${tag}.responsible_party_id`, detail: 'dangling party reference', hard: true });
    }
  }

  // 2. Handoffs
  for (const h of handoffs) {
    const tag = `handoffs[${h.id}]`;
    if (!stepIds.has(h.from_step_id)) {
      violations.push({ field: `${tag}.from_step_id`, detail: 'dangling from_step reference', hard: true });
    }
    if (!stepIds.has(h.to_step_id)) {
      violations.push({ field: `${tag}.to_step_id`, detail: 'dangling to_step reference', hard: true });
    }
    if ((h.kind === 'branch' || h.kind === 'loop') && !h.condition?.trim()) {
      violations.push({ field: `${tag}.condition`, detail: `${h.kind} handoff requires a condition`, hard: true });
    }
  }

  // 5. Documents
  for (const d of documents) {
    const tag = `documents[${d.id}]`;
    if (!VALID_DOC_TYPES.has(d.doc_type)) {
      violations.push({ field: `${tag}.doc_type`, detail: `invalid doc_type ${d.doc_type}`, hard: true });
    }
    const hasEs = Boolean(d.canonical_term_es?.trim());
    const hasEn = Boolean(d.canonical_term_en?.trim());
    if (!hasEs && !hasEn) {
      violations.push({ field: `${tag}.canonical_term`, detail: 'at least one canonical term required', hard: true });
    } else {
      // 6. Bilingual completeness: if the term is a glossary term, BOTH ES and EN required → flag (soft).
      const term = (d.canonical_term_es ?? d.canonical_term_en ?? '').toLowerCase().trim();
      if (term && isGlossaryTerm(term) && !(hasEs && hasEn)) {
        violations.push({ field: `${tag}.canonical_term_en`, detail: 'glossary term missing its bilingual gloss', hard: false });
      }
    }
  }

  // 4. Output→input chain: an output io_item not consumed as an input by any LATER step → flag (soft).
  const sortedSteps = [...steps].sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    if (!step) continue;
    for (const outId of step.outputs ?? []) {
      const consumedLater = sortedSteps.slice(i + 1).some((later) => (later.inputs ?? []).includes(outId));
      if (!consumedLater) {
        // Legitimately terminal outputs exist (the archived expediente) — so this is a soft flag, never a fail.
        violations.push({
          field: `steps[${step.id}].outputs[${outId}]`,
          detail: 'output not consumed by any later step (may be a terminal output)',
          hard: false,
        });
      }
    }
  }

  return violations;
}

function isGlossaryTerm(term: string): boolean {
  return GLOSSARY_TERMS.some((g) => term.includes(g) || g.includes(term));
}

// Apply blank-and-flag: for each HARD violation, blank the offending field and record a confidence_flag.
// Soft violations are recorded as coverage_gaps / confidence_flags but never blank a field. Returns the
// (possibly mutated) draft + the flags. This is the terminal step after a failed regenerate.
export function applyBlankAndFlag(draft: ProcessDraft, violations: Violation[]): ValidationResult {
  // Deep clone so we never mutate the caller's object.
  const next: ProcessDraft = JSON.parse(JSON.stringify(draft));
  const confidence_flags: ConfidenceFlag[] = [];
  const coverage_gaps: string[] = [];

  for (const v of violations) {
    if (v.hard) {
      blankField(next, v.field);
      confidence_flags.push({ field: v.field, reason: v.detail });
      coverage_gaps.push(v.field);
    } else {
      // Soft: flag for the editor, do not blank.
      confidence_flags.push({ field: v.field, reason: v.detail });
      coverage_gaps.push(v.field);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    coverage_gaps,
    confidence_flags,
    draft: next,
  };
}

// Blank a single offending field on the draft, addressed by the validator's field path.
// We support the specific paths the checks emit (steps[id].field, handoffs[id].field, documents[id].field).
function blankField(draft: ProcessDraft, fieldPath: string): void {
  const m = /^(steps|handoffs|documents)\[([^\]]+)\]\.(.+)$/.exec(fieldPath);
  if (!m) return;
  const [, collection, id, rawField] = m;
  if (!collection || !id || !rawField) return;
  const field = rawField.split('[')[0] ?? rawField; // strip any [index] suffix
  if (collection === 'steps') {
    const step = (draft.steps ?? []).find((s) => s.id === id);
    if (step) clearStepField(step, field);
  } else if (collection === 'handoffs') {
    const h = (draft.handoffs ?? []).find((x) => x.id === id);
    if (h) clearHandoffField(h, field);
  } else if (collection === 'documents') {
    const d = (draft.documents ?? []).find((x) => x.id === id);
    if (d) clearDocField(d, field);
  }
}

function clearStepField(step: DraftStep, field: string): void {
  // Never blank required structural ids; blank the bad VALUE so the editor fills it honestly.
  if (field === 'responsible_party_id') step.responsible_party_id = null;
  else if (field === 'title_es') step.title_es = '';
  // sequence_index / inputs / outputs problems are surfaced as gaps, not destructively cleared.
}

function clearHandoffField(handoff: DraftHandoff, field: string): void {
  if (field === 'condition') handoff.condition = null;
  // dangling from/to references are surfaced as gaps; we do not delete the edge silently.
}

function clearDocField(doc: DraftDocument, field: string): void {
  if (field === 'doc_type') doc.doc_type = 'Other';
  else if (field === 'canonical_term_en') doc.canonical_term_en = null;
}
