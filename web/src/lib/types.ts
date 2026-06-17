// Shared API types. These mirror the EXACT response shapes of Builder B's /api/v1 routes + the Prisma schema
// enums (server/prisma/schema.prisma). They are the contract the typed API client (api.ts) and the views read.
// Where the server returns a Prisma row we type only the fields the SPA actually renders.

export type Locale = 'es' | 'en';

export type UserRole = 'editor' | 'viewer' | 'admin';
export type ProcessStatus = 'draft' | 'active' | 'archived';
export type StepType = 'TRANSFORMATION' | 'VERIFICATION' | 'ROUTING' | 'COMMUNICATION' | 'DOCUMENTATION';
export type Classification = 'CRITICAL' | 'AUTOMATABLE' | 'REPETITIVE' | 'CANDIDATE_FOR_REMOVAL';
export type Confidence = 'CONFIRMED' | 'INFERRED' | 'FLAGGED';
export type RagStatus = 'green' | 'amber' | 'red' | 'unknown';
export type HandoffKind = 'sequential' | 'branch' | 'loop' | 'parallel';
export type PartyKind = 'internal_editor' | 'internal_viewer' | 'external';
export type IoKind = 'information' | 'material';
export type StepIoRole = 'input' | 'output';
export type StepDocumentRole = 'consumes' | 'produces' | 'references';
export type DocFormat = 'PDF' | 'XLS' | 'DOCX' | 'XML' | 'other';
export type DocType =
  | 'PurchaseOrder' | 'CommercialInvoice' | 'PackingList' | 'BillOfLading' | 'CartaPorte'
  | 'CertificateOfOrigin' | 'Permit_NOM' | 'Pedimento' | 'PaymentReceipt' | 'InspectionActa'
  | 'GoodsReceipt' | 'Expediente' | 'Other';

export const DOC_TYPES: DocType[] = [
  'PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte', 'CertificateOfOrigin',
  'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa', 'GoodsReceipt', 'Expediente', 'Other',
];

export const STEP_TYPES: StepType[] = ['TRANSFORMATION', 'VERIFICATION', 'ROUTING', 'COMMUNICATION', 'DOCUMENTATION'];
export const CLASSIFICATIONS: Classification[] = ['CRITICAL', 'AUTOMATABLE', 'REPETITIVE', 'CANDIDATE_FOR_REMOVAL'];
export const HANDOFF_KINDS: HandoffKind[] = ['sequential', 'branch', 'loop', 'parallel'];
export const PARTY_KINDS: PartyKind[] = ['internal_editor', 'internal_viewer', 'external'];

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  language_pref: Locale;
  is_active: boolean;
}

export interface LoginResponse {
  user: PublicUser;
  expires_at: string;
}

export interface AdminUser extends PublicUser {
  failed_attempts?: number;
  locked_until?: string | null;
  created_at?: string;
}

export interface Process {
  id: string;
  title_es: string;
  title_en: string | null;
  description_es: string | null;
  description_en: string | null;
  domain: string | null;
  overall_owner_party_id: string | null;
  status: ProcessStatus;
  language_default: Locale;
  created_at: string;
  updated_at: string;
}

export interface PartyRef {
  id: string;
  name: string;
  email: string | null;
  key_person_risk: boolean;
}

export interface ResponsibleParty {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  organization: string | null;
  party_kind: PartyKind;
  user_id: string | null;
  key_person_risk: boolean;
  backup_noted: boolean;
  notes_es: string | null;
  notes_en: string | null;
}

// A node in GET /processes/:id/map (process-registry getProcessGraph).
export interface GraphNode {
  id: string;
  sequence_index: number;
  title_es: string;
  title_en: string | null;
  step_type: StepType | null;
  classification: Classification | null;
  confidence: Confidence;
  rag_status: RagStatus;
  last_reviewed_at: string | null;
  owner: PartyRef | null;
  has_owner_gap: boolean;
  document_count: number;
  input_count: number;
  output_count: number;
}

export interface GraphEdge {
  id: string;
  from_step_id: string;
  to_step_id: string;
  kind: HandoffKind;
  condition_es: string | null;
  condition_en: string | null;
}

export interface ProcessGraph {
  process: Process;
  overall_owner: ResponsibleParty | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IoItem {
  id: string;
  process_id: string;
  name_es: string;
  name_en: string | null;
  kind: IoKind;
  description_es: string | null;
  description_en: string | null;
}

export interface DocumentRow {
  id: string;
  name: string;
  doc_type: DocType;
  format: DocFormat;
  canonical_term_es: string | null;
  canonical_term_en: string | null;
  storage_path: string | null;
  content_type: string | null;
  size_bytes: string | null; // BigInt serialised as string by the server
  created_at: string;
  is_archived: boolean;
}

export interface StepDocumentLink {
  role: StepDocumentRole;
  document: DocumentRow;
}

export interface HandoffRow {
  id: string;
  process_id: string;
  from_step_id: string;
  to_step_id: string;
  kind: HandoffKind;
  condition_es: string | null;
  condition_en: string | null;
}

// GET /steps/:id (process-registry getStepDetail).
export interface StepDetail {
  id: string;
  process_id: string;
  sequence_index: number;
  title_es: string;
  title_en: string | null;
  description_es: string | null;
  description_en: string | null;
  trigger_es: string | null;
  trigger_en: string | null;
  action_es: string | null;
  action_en: string | null;
  reason_es: string | null;
  reason_en: string | null;
  step_type: StepType | null;
  classification: Classification | null;
  confidence: Confidence;
  common_issues_es: string | null;
  common_issues_en: string | null;
  responsible_party_id: string | null;
  rag_status: RagStatus;
  last_reviewed_at: string | null;
  updated_at: string;
  responsible_party: ResponsibleParty | null;
  process: { id: string; title_es: string; title_en: string | null };
  inputs: IoItem[];
  outputs: IoItem[];
  documents: StepDocumentLink[];
  handoffs_out: HandoffRow[];
  handoffs_in: HandoffRow[];
}

// ---- Interview / Draft ----
export interface DraftDocumentMeta {
  id: string;
  name: string;
  doc_type: DocType;
  format?: DocFormat | null;
  canonical_term_es?: string | null;
  canonical_term_en?: string | null;
}

export interface DraftStep {
  id: string;
  sequence_index: number;
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  trigger?: string | null;
  action?: string | null;
  reason?: string | null;
  step_type?: StepType | null;
  classification?: Classification | null;
  confidence: Confidence;
  common_issues?: string | null;
  responsible_party_id?: string | null;
  inputs?: string[];
  outputs?: string[];
  documents?: { document_id: string; role: StepDocumentRole }[];
}

export interface DraftHandoff {
  id: string;
  from_step_id: string;
  to_step_id: string;
  kind: HandoffKind;
  condition?: string | null;
}

export interface DraftParty {
  id: string;
  name: string;
  role?: string | null;
  email?: string | null;
  organization?: string | null;
  party_kind: PartyKind;
  key_person_risk?: boolean;
  backup_noted?: boolean;
  notes?: string | null;
}

export interface DraftIoItem {
  id: string;
  name: string;
  kind: IoKind;
  description?: string | null;
}

export interface ProcessDraftBody {
  process: {
    title_es: string;
    title_en?: string | null;
    description_es?: string | null;
    description_en?: string | null;
    domain?: string | null;
  };
  steps: DraftStep[];
  handoffs?: DraftHandoff[];
  parties?: DraftParty[];
  io_items?: DraftIoItem[];
  documents?: DraftDocumentMeta[];
  is_complete?: boolean;
}

export interface ConfidenceFlag {
  field: string;
  reason: string;
}

export interface DraftReviewResponse {
  draft: ProcessDraftBody;
  status: 'in_interview' | 'ready_for_review';
  coverage_gaps: string[];
  confidence_flags: ConfidenceFlag[];
  published_process_id: string | null;
}

// ---- Freshness ----
export type FreshnessKind =
  | 'no_owner' | 'key_person_risk' | 'missing_document' | 'no_contact' | 'stale_review' | 'broken_structure';
export type FreshnessSeverity = 'high' | 'medium' | 'low';
export type FreshnessActionHint = 'relaunch_interview' | 'add_contact' | 'attach_document' | 'confirm_current';

export interface FreshnessFlag {
  kind: FreshnessKind;
  step_id?: string | null;
  severity: FreshnessSeverity;
  detail_es: string;
  detail_en: string;
}

export interface FreshnessSuggestion {
  step_id?: string | null;
  field: string;
  current?: string | null;
  suggestion_es: string;
  suggestion_en: string;
  action_hint: FreshnessActionHint;
}

export interface FreshnessReport {
  id: string;
  process_id: string;
  scanned_at: string;
  trigger: string | null;
  flags: FreshnessFlag[];
  suggested_edits: FreshnessSuggestion[];
  summary_es: string | null;
  summary_en: string | null;
}

// ---- Settings (admin) ----
export interface AppSettings {
  default_language: Locale;
  stale_days: number;
  soon_days: number;
  interview_turn_budget: number;
  [key: string]: unknown;
}
