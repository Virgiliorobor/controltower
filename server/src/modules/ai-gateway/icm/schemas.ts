// Structured-output JSON schemas for the ICM specialists (icm_spec/_database/schema.json).
// Used as Anthropic `output_config.format = { type: 'json_schema', schema }` (models.yaml
// format: "json_schema:process_draft" / "json_schema:freshness_report"). Strict shapes so the model returns
// data we can deterministically validate — the interview produces a process_draft; freshness a freshness_report.
//
// NB: the Structured Outputs schema dialect does not support numeric/length constraints; we keep shapes plain
// and enforce business rules (sequence uniqueness, reference integrity, bilingual completeness) in the
// deterministic Draft Validator (validator.ts), not in the schema.

export const PROCESS_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['process', 'steps'],
  properties: {
    process: {
      type: 'object',
      additionalProperties: false,
      required: ['title_es'],
      properties: {
        title_es: { type: 'string' },
        title_en: { type: ['string', 'null'] },
        description_es: { type: ['string', 'null'] },
        description_en: { type: ['string', 'null'] },
        domain: { type: ['string', 'null'] },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'sequence_index', 'title_es', 'confidence'],
        properties: {
          id: { type: 'string' },
          sequence_index: { type: 'integer' },
          title_es: { type: 'string' },
          title_en: { type: ['string', 'null'] },
          description_es: { type: ['string', 'null'] },
          trigger: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
          step_type: {
            type: ['string', 'null'],
            enum: ['TRANSFORMATION', 'VERIFICATION', 'ROUTING', 'COMMUNICATION', 'DOCUMENTATION', null],
          },
          classification: {
            type: ['string', 'null'],
            enum: ['CRITICAL', 'AUTOMATABLE', 'REPETITIVE', 'CANDIDATE_FOR_REMOVAL', null],
          },
          confidence: { type: 'string', enum: ['CONFIRMED', 'INFERRED', 'FLAGGED'] },
          common_issues: { type: ['string', 'null'] },
          responsible_party_id: { type: ['string', 'null'] },
          inputs: { type: 'array', items: { type: 'string' } },
          outputs: { type: 'array', items: { type: 'string' } },
          documents: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['document_id', 'role'],
              properties: {
                document_id: { type: 'string' },
                role: { type: 'string', enum: ['consumes', 'produces', 'references'] },
              },
            },
          },
        },
      },
    },
    handoffs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'from_step_id', 'to_step_id', 'kind'],
        properties: {
          id: { type: 'string' },
          from_step_id: { type: 'string' },
          to_step_id: { type: 'string' },
          kind: { type: 'string', enum: ['sequential', 'branch', 'loop', 'parallel'] },
          condition: { type: ['string', 'null'] },
        },
      },
    },
    parties: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'party_kind'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          role: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          organization: { type: ['string', 'null'] },
          party_kind: { type: 'string', enum: ['internal_editor', 'internal_viewer', 'external'] },
          key_person_risk: { type: 'boolean' },
          backup_noted: { type: 'boolean' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    io_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'kind'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['information', 'material'] },
          description: { type: ['string', 'null'] },
        },
      },
    },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'doc_type'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          doc_type: {
            type: 'string',
            enum: [
              'PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte',
              'CertificateOfOrigin', 'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa',
              'GoodsReceipt', 'Expediente', 'Other',
            ],
          },
          format: { type: ['string', 'null'], enum: ['PDF', 'XLS', 'DOCX', 'XML', 'other', null] },
          canonical_term_es: { type: ['string', 'null'] },
          canonical_term_en: { type: ['string', 'null'] },
        },
      },
    },
    is_complete: {
      type: 'boolean',
      description: 'true when the interview has reached a natural end and the draft is ready for review',
    },
  },
} as const;

// The next interview turn. We use a structured shape so the assistant prompt and a running draft come back
// together: the prompt is streamed to the client (SSE), and the partial draft updates the live preview map.
export const INTERVIEW_TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistant_message', 'is_complete'],
  properties: {
    assistant_message: {
      type: 'string',
      description: 'The single next Spanish-first question (or the closing message when is_complete=true)',
    },
    is_complete: { type: 'boolean' },
    draft: PROCESS_DRAFT_SCHEMA,
  },
} as const;

export const FRESHNESS_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['flags', 'suggested_edits', 'summary_es', 'summary_en'],
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'severity', 'detail_es', 'detail_en'],
        properties: {
          kind: {
            type: 'string',
            enum: ['no_owner', 'key_person_risk', 'missing_document', 'no_contact', 'stale_review', 'broken_structure'],
          },
          step_id: { type: ['string', 'null'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          detail_es: { type: 'string' },
          detail_en: { type: 'string' },
        },
      },
    },
    suggested_edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'suggestion_es', 'suggestion_en', 'action_hint'],
        properties: {
          step_id: { type: ['string', 'null'] },
          field: { type: 'string' },
          current: { type: ['string', 'null'] },
          suggestion_es: { type: 'string' },
          suggestion_en: { type: 'string' },
          action_hint: {
            type: 'string',
            enum: ['relaunch_interview', 'add_contact', 'attach_document', 'confirm_current'],
          },
        },
      },
    },
    summary_es: { type: 'string' },
    summary_en: { type: 'string' },
  },
} as const;

// ---- TypeScript shapes mirroring the schemas (for the validator + persistence) -----------------------------

export interface DraftStep {
  id: string;
  sequence_index: number;
  title_es: string;
  title_en?: string | null;
  description_es?: string | null;
  trigger?: string | null;
  action?: string | null;
  reason?: string | null;
  step_type?: string | null;
  classification?: string | null;
  confidence: 'CONFIRMED' | 'INFERRED' | 'FLAGGED';
  common_issues?: string | null;
  responsible_party_id?: string | null;
  inputs?: string[];
  outputs?: string[];
  documents?: { document_id: string; role: string }[];
}

export interface DraftHandoff {
  id: string;
  from_step_id: string;
  to_step_id: string;
  kind: 'sequential' | 'branch' | 'loop' | 'parallel';
  condition?: string | null;
}

export interface DraftParty {
  id: string;
  name: string;
  role?: string | null;
  email?: string | null;
  organization?: string | null;
  party_kind: 'internal_editor' | 'internal_viewer' | 'external';
  key_person_risk?: boolean;
  backup_noted?: boolean;
  notes?: string | null;
}

export interface DraftIoItem {
  id: string;
  name: string;
  kind: 'information' | 'material';
  description?: string | null;
}

export interface DraftDocument {
  id: string;
  name: string;
  doc_type: string;
  format?: string | null;
  canonical_term_es?: string | null;
  canonical_term_en?: string | null;
}

export interface ProcessDraft {
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
  documents?: DraftDocument[];
  is_complete?: boolean;
}

export interface InterviewTurnOutput {
  assistant_message: string;
  is_complete: boolean;
  draft?: ProcessDraft;
}

export interface FreshnessFlag {
  kind: string;
  step_id?: string | null;
  severity: 'high' | 'medium' | 'low';
  detail_es: string;
  detail_en: string;
}

export interface FreshnessSuggestion {
  step_id?: string | null;
  field: string;
  current?: string | null;
  suggestion_es: string;
  suggestion_en: string;
  action_hint: string;
}

export interface FreshnessReportOutput {
  flags: FreshnessFlag[];
  suggested_edits: FreshnessSuggestion[];
  summary_es: string;
  summary_en: string;
}
