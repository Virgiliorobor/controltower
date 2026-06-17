// The event catalog and the standard envelope (technical.md §EVENT STANDARDS).
// event_type is always past-tense dot-notation. This is the single inter-module contract (Rule 4):
// modules communicate ONLY by emitting/subscribing to these events — never by direct calls.

import { randomUUID } from 'node:crypto';

// Every event_type the system knows. Builders B and C add to this union (and only this union) when they
// introduce a new event; the EventBus is typed against it so a typo becomes a compile error.
export type EventType =
  // auth-rbac
  | 'user.login_requested'
  | 'user.authenticated'
  | 'user.auth_failed'
  | 'user.session_expired'
  | 'user.logout_requested'
  | 'user.logged_out'
  | 'user.created'
  | 'user.updated'
  // process-registry
  | 'process.created'
  | 'process.updated'
  | 'process.published'
  | 'process.archived'
  | 'step.created'
  | 'step.updated'
  | 'step.archived'
  | 'step.reordered'
  | 'step.reviewed'
  | 'step.confidence_changed'
  | 'handoff.created'
  | 'handoff.updated'
  | 'handoff.archived'
  | 'party.created'
  | 'party.updated'
  | 'party.archived'
  | 'io_item.created'
  | 'io_item.updated'
  | 'io_item.archived'
  | 'step.io_linked'
  | 'step.io_unlinked'
  | 'step.document_linked'
  | 'step.document_unlinked'
  // documents
  | 'file.upload_requested'
  | 'file.uploaded'
  | 'file.updated'
  | 'file.deleted'
  | 'file.access_denied'
  | 'file.retrieve_requested'
  // ai-gateway / ICM
  | 'interview.started'
  | 'interview.turn_submitted'
  | 'interview.prompt_ready'
  | 'interview.draft_ready'
  | 'freshness.scan_requested'
  | 'freshness.report_ready'
  // system
  | 'system.error'
  | 'system.session_started';

export interface EventMetadata {
  project_id: string;
  session_id?: string;
  triggered_by?: string;
}

export interface DomainEvent<TPayload = Record<string, unknown>> {
  event_id: string;
  event_type: EventType;
  timestamp: string;
  source_node: string;
  payload: TPayload;
  metadata: EventMetadata;
}

export const PROJECT_ID = 'customs-control-tower';

export interface EmitOptions {
  source_node: string;
  metadata?: Partial<EventMetadata>;
}

export function buildEvent<TPayload extends Record<string, unknown>>(
  eventType: EventType,
  payload: TPayload,
  options: EmitOptions,
): DomainEvent<TPayload> {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    source_node: options.source_node,
    payload,
    metadata: {
      project_id: PROJECT_ID,
      ...options.metadata,
    },
  };
}
