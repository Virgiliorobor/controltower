// Typed endpoint wrappers over apiFetch (lib/api.ts). RELATIVE /api/v1 paths only (Rule 1, no host).
// Each function maps 1:1 to a Builder B route + its request/response shape (see server/src/modules/*/routes.ts).
// Views call these, never raw fetch — so the contract lives in one place and tsc catches a shape drift.

import { api, apiFetch } from './api';
import type {
  AdminUser,
  AppSettings,
  DocumentRow,
  DraftReviewResponse,
  FreshnessReport,
  GraphNode,
  HandoffKind,
  HandoffRow,
  IoItem,
  Locale,
  LoginResponse,
  Process,
  ProcessGraph,
  ProcessStatus,
  PublicUser,
  ResponsibleParty,
  StepDetail,
  StepDocumentRole,
  StepIoRole,
  Classification,
  Confidence,
  PartyKind,
  StepType,
  IoKind,
} from './types';

// ---- Auth (auth-rbac/routes.ts) ----
export const authApi = {
  login: (email: string, password: string) => api.post<LoginResponse>('/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  me: () => api.get<{ user: PublicUser | null }>('/me'),
};

// ---- Admin users + settings ----
export const adminApi = {
  listUsers: () => api.get<{ users: AdminUser[] }>('/users'),
  createUser: (body: { email: string; password: string; role?: string; language_pref?: Locale }) =>
    api.post<{ user: AdminUser }>('/users', body),
  updateUser: (id: string, body: { role?: string; is_active?: boolean; language_pref?: Locale }) =>
    api.patch<{ user: AdminUser }>(`/users/${id}`, body),
  getSettings: () => api.get<{ settings: AppSettings }>('/settings'),
  updateSettings: (body: Partial<AppSettings>) => api.patch<{ settings: AppSettings }>('/settings', body),
};

// ---- Processes (process-registry/routes.ts) ----
export interface CreateProcessBody {
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  description_en?: string | null;
  domain?: string | null;
  language_default?: Locale;
}

export interface UpdateProcessBody extends Partial<CreateProcessBody> {
  overall_owner_party_id?: string | null;
}

// ---- Whole-graph Save (MAJ-01 / MAJ-02). The human's single Save of a complete process. ref strings are
// client-local ids that wire the graph together; the server resolves them to uuids in one transaction.
// This posts to process-registry (the single writer) as an editor action — the AI is never in this path.
export interface SaveGraphPartyBody {
  ref: string;
  existing_party_id?: string | null; // reuse a directory party by uuid, else create from these fields
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
export interface SaveGraphIoItemBody {
  ref: string;
  name_es: string;
  name_en?: string | null;
  kind: IoKind;
  description_es?: string | null;
  description_en?: string | null;
}
export interface SaveGraphStepBody {
  ref: string;
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
  responsible_party_ref?: string | null;
  io?: { io_ref: string; role: StepIoRole }[];
  documents?: { document_id: string; role: StepDocumentRole }[];
}
export interface SaveGraphHandoffBody {
  from_step_ref: string;
  to_step_ref: string;
  kind: HandoffKind;
  condition_es?: string | null;
  condition_en?: string | null;
}
export interface SaveGraphBody {
  process: CreateProcessBody & { overall_owner_party_ref?: string | null };
  parties?: SaveGraphPartyBody[];
  io_items?: SaveGraphIoItemBody[];
  steps: SaveGraphStepBody[];
  handoffs?: SaveGraphHandoffBody[];
  publish?: boolean;
}

export const processApi = {
  list: (filters: { status?: ProcessStatus; has_unowned?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.has_unowned) params.set('has_unowned', 'true');
    const qs = params.toString();
    return api.get<{ processes: Process[] }>(`/processes${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api.get<{ process: Process }>(`/processes/${id}`),
  create: (body: CreateProcessBody) => api.post<{ process: Process }>('/processes', body),
  // The whole-graph Save (MAJ-01 / MAJ-02): one human-initiated call persists the complete process graph
  // (parties + io_items + steps with per-step owner + step_io + step_documents + handoffs) atomically.
  saveGraph: (body: SaveGraphBody) => api.post<{ process: Process }>('/processes/save-graph', body),
  update: (id: string, body: UpdateProcessBody) => api.patch<{ process: Process }>(`/processes/${id}`, body),
  publish: (id: string) => api.post<{ process: Process }>(`/processes/${id}/publish`),
  archive: (id: string) => api.post<{ process: Process }>(`/processes/${id}/archive`),
  map: (id: string) => api.get<ProcessGraph>(`/processes/${id}/map`),
  reorder: (id: string, order: { step_id: string; sequence_index: number }[]) =>
    api.post<{ ok: true }>(`/processes/${id}/reorder`, { order }),
};

// ---- Steps ----
export interface CreateStepBody {
  sequence_index?: number;
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

export const stepApi = {
  create: (processId: string, body: CreateStepBody) =>
    api.post<{ step: StepDetail }>(`/processes/${processId}/steps`, body),
  get: (id: string) => api.get<{ step: StepDetail }>(`/steps/${id}`),
  update: (id: string, body: Partial<CreateStepBody>) => api.patch<{ step: StepDetail }>(`/steps/${id}`, body),
  archive: (id: string) => api.post<{ step: StepDetail }>(`/steps/${id}/archive`),
  review: (id: string) => api.post<{ step: StepDetail }>(`/steps/${id}/review`),
  confirm: (id: string) => api.post<{ step: StepDetail }>(`/steps/${id}/confirm`),
  linkDocument: (id: string, document_id: string, role: StepDocumentRole) =>
    api.post<{ ok: true }>(`/steps/${id}/documents`, { document_id, role }),
  unlinkDocument: (id: string, documentId: string, role: StepDocumentRole) =>
    apiFetch<{ ok: true }>(`/steps/${id}/documents/${documentId}`, { method: 'DELETE', body: { role } }),
  linkIo: (id: string, io_item_id: string, role: StepIoRole) =>
    api.post<{ ok: true }>(`/steps/${id}/io`, { io_item_id, role }),
  unlinkIo: (id: string, io_item_id: string, role: StepIoRole) =>
    apiFetch<{ ok: true }>(`/steps/${id}/io`, { method: 'DELETE', body: { io_item_id, role } }),
};

// ---- IO items ----
export const ioApi = {
  list: (processId: string) => api.get<{ io_items: IoItem[] }>(`/processes/${processId}/io-items`),
  create: (
    processId: string,
    body: { name_es: string; name_en?: string | null; kind: IoKind; description_es?: string | null; description_en?: string | null },
  ) => api.post<{ io_item: IoItem }>(`/processes/${processId}/io-items`, body),
};

// ---- Handoffs ----
export interface CreateHandoffBody {
  process_id: string;
  from_step_id: string;
  to_step_id: string;
  kind: HandoffKind;
  condition_es?: string | null;
  condition_en?: string | null;
}

export const handoffApi = {
  create: (body: CreateHandoffBody) => api.post<{ handoff: HandoffRow }>('/handoffs', body),
  update: (id: string, body: { kind?: HandoffKind; condition_es?: string | null; condition_en?: string | null }) =>
    api.patch<{ handoff: HandoffRow }>(`/handoffs/${id}`, body),
  remove: (id: string) => api.del<{ handoff: HandoffRow }>(`/handoffs/${id}`),
};

// ---- Responsible parties ----
export interface PartyBody {
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

export const partyApi = {
  list: () => api.get<{ parties: ResponsibleParty[] }>('/parties'),
  create: (body: PartyBody) => api.post<{ party: ResponsibleParty }>('/parties', body),
  update: (id: string, body: Partial<PartyBody>) => api.patch<{ party: ResponsibleParty }>(`/parties/${id}`, body),
  remove: (id: string) => api.del<{ party: ResponsibleParty }>(`/parties/${id}`),
};

// ---- Documents ----
export const documentApi = {
  // Multipart upload: a FormData with the file + text fields. apiFetch detects FormData and skips JSON headers.
  upload: (form: FormData) => api.post<{ document: DocumentRow }>('/documents', form),
  get: (id: string) => api.get<{ document: DocumentRow; url: string | null }>(`/documents/${id}`),
  update: (
    id: string,
    body: { name?: string; doc_type?: string; canonical_term_es?: string | null; canonical_term_en?: string | null },
  ) => api.patch<{ document: DocumentRow }>(`/documents/${id}`, body),
  archive: (id: string) => api.post<{ document: DocumentRow }>(`/documents/${id}/archive`),
};

// ---- AI gateway: interview draft + freshness (non-streaming reads/actions) ----
export const aiApi = {
  finishInterview: (draftId: string) => api.post<{ status: string; passed: boolean }>(`/interviews/${draftId}/finish`),
  getDraft: (draftId: string) => api.get<DraftReviewResponse>(`/interviews/${draftId}`),
  freshnessScan: (processId: string) => api.post<{ report_id: string }>(`/processes/${processId}/freshness-scan`),
  freshness: (processId: string) => api.get<{ report: FreshnessReport }>(`/processes/${processId}/freshness`),
};

// Derived rolled-up RAG for a process header/selector dot: worst node health wins (red>amber>green>unknown).
export function rollupRag(nodes: { rag_status: string }[]): 'green' | 'amber' | 'red' | 'unknown' {
  if (nodes.some((n) => n.rag_status === 'red')) return 'red';
  if (nodes.some((n) => n.rag_status === 'amber')) return 'amber';
  if (nodes.length > 0 && nodes.every((n) => n.rag_status === 'green')) return 'green';
  return 'unknown';
}

export function countUnconfirmed(nodes: GraphNode[]): number {
  return nodes.filter((n) => n.confidence !== 'CONFIRMED').length;
}
