// DERIVED RAG status — the single source of truth for step health (architecture_spec §3.3).
// rag_status is NEVER hand-entered: the registry recomputes it on any write to a step (and on a freshness
// result) from completeness + freshness, then persists it denormalized for fast map rendering.
//
// Kept ORTHOGONAL to the other two visual channels (DC-3):
//   - rag_status (here)   = derived HEALTH (green/amber/red/unknown)
//   - confidence          = operator TRUST (CONFIRMED/INFERRED/FLAGGED) — NOT an input to RAG
//   - classification      = emphasis (CRITICAL/…)                       — NOT an input to RAG
// This module reads ONLY completeness + freshness + structural integrity, never confidence/classification.
//
// Rules (architecture_spec §3.3):
//   green  = owner present + contact (email) present + required docs attached + reviewed within stale_days
//            + structure intact (no dangling/structural break).
//   amber  = reviewed within the soon_days window, OR a non-critical gap (missing EN gloss, soft owner gap).
//   red    = no owner, OR no contact on a step that needs one, OR a structural break (dangling handoff),
//            OR stale beyond stale_days.
//   unknown= brand-new/seed step not yet evaluated (only used as the column default; a real evaluation
//            always resolves to green/amber/red).
// Thresholds (stale_days / soon_days) come from app_settings via the caller — never hardcoded here.

import type { RagStatus } from '@prisma/client';

export interface RagThresholds {
  stale_days: number;
  soon_days: number;
}

// The minimal, decision-relevant projection of a step the RAG rule reads. The service assembles this from
// the persisted row plus its links — RAG itself touches the DB through nothing.
export interface RagStepInput {
  has_owner: boolean; // responsible_party_id set
  has_contact_email: boolean; // the owner party has an email
  owner_required: boolean; // true for every operational step (a step always needs an owner)
  contact_required: boolean; // true when the owner is set but a reachable contact is expected
  required_docs_present: boolean; // any step that an operator marked as needing docs has them attached
  missing_en_gloss: boolean; // a non-critical bilingual gap (soft → amber)
  has_structural_break: boolean; // dangling handoff / output consumed by nothing carried into this step
  last_reviewed_at: Date | null; // null = never reviewed
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}

// Pure function: completeness + freshness + structure → green | amber | red.
// Deterministic and side-effect-free so it is trivially testable and identical on every write path.
export function computeRagStatus(step: RagStepInput, thresholds: RagThresholds, now: Date = new Date()): RagStatus {
  // --- RED conditions (any one trips red) -------------------------------------------------
  if (step.owner_required && !step.has_owner) {
    return 'red'; // no owner is the headline gap — never invented, always surfaced
  }
  if (step.contact_required && step.has_owner && !step.has_contact_email) {
    return 'red'; // owner present but unreachable
  }
  if (step.has_structural_break) {
    return 'red'; // a dangling handoff makes the map lie about the flow
  }
  if (step.last_reviewed_at && daysSince(step.last_reviewed_at, now) > thresholds.stale_days) {
    return 'red'; // stale beyond the hard threshold
  }
  if (!step.last_reviewed_at) {
    // Never reviewed AND otherwise complete → treat as amber (a soft nudge to confirm), not red:
    // a brand-new but fully-specified step is not unhealthy, it just hasn't been confirmed fresh yet.
    return 'amber';
  }

  // --- AMBER conditions (soft gaps / approaching staleness) -------------------------------
  const age = daysSince(step.last_reviewed_at, now);
  if (age > thresholds.soon_days) {
    return 'amber'; // inside the "review soon" window
  }
  if (!step.required_docs_present) {
    return 'amber'; // an implied governing document is not attached (non-structural)
  }
  if (step.missing_en_gloss) {
    return 'amber'; // bilingual completeness gap — visible but not blocking
  }

  // --- GREEN: owner + contact + docs + fresh + structure intact ---------------------------
  return 'green';
}
