-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('editor', 'viewer', 'admin');

-- CreateEnum
CREATE TYPE "LanguageCode" AS ENUM ('es', 'en');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('TRANSFORMATION', 'VERIFICATION', 'ROUTING', 'COMMUNICATION', 'DOCUMENTATION');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('CRITICAL', 'AUTOMATABLE', 'REPETITIVE', 'CANDIDATE_FOR_REMOVAL');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('CONFIRMED', 'INFERRED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "RagStatus" AS ENUM ('green', 'amber', 'red', 'unknown');

-- CreateEnum
CREATE TYPE "HandoffKind" AS ENUM ('sequential', 'branch', 'loop', 'parallel');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('internal_editor', 'internal_viewer', 'external');

-- CreateEnum
CREATE TYPE "IoKind" AS ENUM ('information', 'material');

-- CreateEnum
CREATE TYPE "StepIoRole" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "StepDocumentRole" AS ENUM ('consumes', 'produces', 'references');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte', 'CertificateOfOrigin', 'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa', 'GoodsReceipt', 'Expediente', 'Other');

-- CreateEnum
CREATE TYPE "DocFormat" AS ENUM ('PDF', 'XLS', 'DOCX', 'XML', 'other');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'delivered', 'dead');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('in_interview', 'ready_for_review');

-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('interview_turn', 'interview_finish', 'freshness_scan');

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_node" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_type" TEXT NOT NULL,
    "entity_id" UUID,
    "entity_type" TEXT,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" UUID,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'editor',
    "language_pref" "LanguageCode" NOT NULL DEFAULT 'es',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processes" (
    "id" UUID NOT NULL,
    "title_es" TEXT NOT NULL,
    "title_en" TEXT,
    "description_es" TEXT,
    "description_en" TEXT,
    "domain" TEXT DEFAULT 'IMMEX import MX←US',
    "overall_owner_party_id" UUID,
    "status" "ProcessStatus" NOT NULL DEFAULT 'draft',
    "language_default" "LanguageCode" NOT NULL DEFAULT 'es',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steps" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "sequence_index" INTEGER NOT NULL,
    "title_es" TEXT NOT NULL,
    "title_en" TEXT,
    "description_es" TEXT,
    "description_en" TEXT,
    "trigger_es" TEXT,
    "trigger_en" TEXT,
    "action_es" TEXT,
    "action_en" TEXT,
    "reason_es" TEXT,
    "reason_en" TEXT,
    "step_type" "StepType",
    "classification" "Classification",
    "confidence" "Confidence" NOT NULL DEFAULT 'INFERRED',
    "common_issues_es" TEXT,
    "common_issues_en" TEXT,
    "responsible_party_id" UUID,
    "rag_status" "RagStatus" NOT NULL DEFAULT 'unknown',
    "last_reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoffs" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "from_step_id" UUID NOT NULL,
    "to_step_id" UUID NOT NULL,
    "kind" "HandoffKind" NOT NULL,
    "condition_es" TEXT,
    "condition_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsible_parties" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "organization" TEXT,
    "party_kind" "PartyKind" NOT NULL,
    "user_id" UUID,
    "key_person_risk" BOOLEAN NOT NULL DEFAULT false,
    "backup_noted" BOOLEAN NOT NULL DEFAULT false,
    "notes_es" TEXT,
    "notes_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "responsible_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "io_items" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT,
    "kind" "IoKind" NOT NULL,
    "description_es" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "io_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_io" (
    "step_id" UUID NOT NULL,
    "io_item_id" UUID NOT NULL,
    "role" "StepIoRole" NOT NULL,

    CONSTRAINT "step_io_pkey" PRIMARY KEY ("step_id","io_item_id","role")
);

-- CreateTable
CREATE TABLE "step_documents" (
    "step_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "role" "StepDocumentRole" NOT NULL,

    CONSTRAINT "step_documents_pkey" PRIMARY KEY ("step_id","document_id","role")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "doc_type" "DocType" NOT NULL,
    "format" "DocFormat" NOT NULL,
    "canonical_term_es" TEXT,
    "canonical_term_en" TEXT,
    "storage_path" TEXT,
    "content_type" TEXT,
    "size_bytes" BIGINT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_drafts" (
    "id" UUID NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'in_interview',
    "language" "LanguageCode" NOT NULL DEFAULT 'es',
    "editor_id" UUID,
    "process_seed" JSONB,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "coverage_gaps" JSONB NOT NULL DEFAULT '[]',
    "confidence_flags" JSONB NOT NULL DEFAULT '[]',
    "events" JSONB NOT NULL DEFAULT '[]',
    "published_process_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "process_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freshness_reports" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "suggested_edits" JSONB NOT NULL DEFAULT '[]',
    "summary_es" TEXT,
    "summary_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freshness_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "draft_id" UUID,
    "process_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_read_input_tokens" INTEGER,
    "cache_creation_input_tokens" INTEGER,
    "latency_ms" INTEGER,
    "cost_usd_est" DECIMAL(12,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_outbox_status_created_at_idx" ON "event_outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "processes_status_idx" ON "processes"("status");

-- CreateIndex
CREATE INDEX "steps_process_id_idx" ON "steps"("process_id");

-- CreateIndex
CREATE INDEX "handoffs_process_id_idx" ON "handoffs"("process_id");

-- CreateIndex
CREATE INDEX "handoffs_from_step_id_idx" ON "handoffs"("from_step_id");

-- CreateIndex
CREATE INDEX "handoffs_to_step_id_idx" ON "handoffs"("to_step_id");

-- CreateIndex
CREATE INDEX "io_items_process_id_idx" ON "io_items"("process_id");

-- CreateIndex
CREATE INDEX "process_drafts_status_idx" ON "process_drafts"("status");

-- CreateIndex
CREATE INDEX "freshness_reports_process_id_scanned_at_idx" ON "freshness_reports"("process_id", "scanned_at");

-- CreateIndex
CREATE INDEX "ai_runs_kind_created_at_idx" ON "ai_runs"("kind", "created_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_overall_owner_party_id_fkey" FOREIGN KEY ("overall_owner_party_id") REFERENCES "responsible_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_responsible_party_id_fkey" FOREIGN KEY ("responsible_party_id") REFERENCES "responsible_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_from_step_id_fkey" FOREIGN KEY ("from_step_id") REFERENCES "steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_to_step_id_fkey" FOREIGN KEY ("to_step_id") REFERENCES "steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsible_parties" ADD CONSTRAINT "responsible_parties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "io_items" ADD CONSTRAINT "io_items_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_io" ADD CONSTRAINT "step_io_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_io" ADD CONSTRAINT "step_io_io_item_id_fkey" FOREIGN KEY ("io_item_id") REFERENCES "io_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_documents" ADD CONSTRAINT "step_documents_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_documents" ADD CONSTRAINT "step_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

