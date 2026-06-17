// Idempotent seed. Run via `npm run seed` (after `prisma migrate deploy`). Safe to run repeatedly.
//   1. Ensure the system app_settings defaults exist.
//   2. Ensure the initial admin user (ADMIN_EMAIL / ADMIN_PASSWORD from env) exists.
//   3. Ensure the 12-step INFERRED IMMEX import process exists as ONE process (status=draft), with its
//      responsible parties, steps (every step confidence=INFERRED, rag_status=unknown), io chain, documents,
//      and the real handoff structure (semáforo BRANCH at Step 8, rework LOOP Step 6→5).
//
// The process is marked clearly as a DRAFT / INFERRED seed — it is a hypothesis to be CORRECTED by a real
// operator (that correction is the product's intended use). No AI is invoked here.

import bcrypt from 'bcryptjs';
import { getDb, disconnectDb } from '../core/db.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { SETTINGS_KEY, DEFAULT_SETTINGS } from '../modules/platform-core/settings.js';
import {
  SEED_PROCESS,
  SEED_PARTIES,
  SEED_STEPS,
  SEED_HANDOFFS,
} from './seed-data.js';

const SEED_TITLE = SEED_PROCESS.title_es;

async function main(): Promise<void> {
  const db = getDb();
  const config = loadConfig();

  // 1. Settings defaults.
  await db.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value_json: DEFAULT_SETTINGS },
    update: {},
  });
  logger.info('seed: app_settings ensured');

  // 2. Initial admin user.
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const email = config.ADMIN_EMAIL.toLowerCase();
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      const password_hash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
      await db.user.create({
        data: { email, password_hash, role: 'admin', language_pref: config.DEFAULT_LOCALE },
      });
      logger.info({ email }, 'seed: admin user created');
    } else {
      logger.info({ email }, 'seed: admin user already exists — left untouched');
    }
  } else {
    logger.warn('seed: ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user creation');
  }

  // 3. The INFERRED seed process. Idempotent on title_es within the seed domain.
  const existingProcess = await db.process.findFirst({
    where: { title_es: SEED_TITLE, domain: SEED_PROCESS.domain },
  });
  if (existingProcess) {
    logger.info({ id: existingProcess.id }, 'seed: process already exists — left untouched (idempotent)');
    await disconnectDb();
    return;
  }

  await db.$transaction(async (tx) => {
    // Parties (keyed for FK wiring within this seed run).
    const partyIdByKey = new Map<string, string>();
    for (const party of SEED_PARTIES) {
      const created = await tx.responsibleParty.create({
        data: {
          name: party.name,
          role: party.role,
          party_kind: party.party_kind,
          organization: party.organization ?? null,
          key_person_risk: party.key_person_risk ?? false,
          notes_es: party.notes_es ?? null,
        },
      });
      partyIdByKey.set(party.key, created.id);
    }

    const process = await tx.process.create({
      data: {
        title_es: SEED_PROCESS.title_es,
        title_en: SEED_PROCESS.title_en,
        description_es: SEED_PROCESS.description_es,
        description_en: SEED_PROCESS.description_en,
        domain: SEED_PROCESS.domain,
        status: 'draft',
        language_default: 'es',
      },
    });

    // io_items deduplicated by ES name across the whole process so an output of one step can be the input
    // of the next (the same item linked to two steps with different roles — the output→input chain).
    const ioIdByName = new Map<string, string>();
    const ensureIo = async (name: string): Promise<string> => {
      const existing = ioIdByName.get(name);
      if (existing) return existing;
      const created = await tx.ioItem.create({
        data: { process_id: process.id, name_es: name, kind: 'information' },
      });
      ioIdByName.set(name, created.id);
      return created.id;
    };

    // documents deduplicated by name so the same document type reused across steps is one row.
    const docIdByName = new Map<string, string>();
    const ensureDoc = async (doc: {
      name: string;
      doc_type: import('@prisma/client').DocType;
      format: import('@prisma/client').DocFormat;
      canonical_term_es: string;
      canonical_term_en: string;
    }): Promise<string> => {
      const existing = docIdByName.get(doc.name);
      if (existing) return existing;
      const created = await tx.document.create({
        data: {
          name: doc.name,
          doc_type: doc.doc_type,
          format: doc.format,
          canonical_term_es: doc.canonical_term_es,
          canonical_term_en: doc.canonical_term_en,
        },
      });
      docIdByName.set(doc.name, created.id);
      return created.id;
    };

    const stepIdByIndex = new Map<number, string>();
    for (const step of SEED_STEPS) {
      const created = await tx.step.create({
        data: {
          process_id: process.id,
          sequence_index: step.sequence_index,
          title_es: step.title_es,
          title_en: step.title_en,
          description_es: step.description_es,
          trigger_es: step.trigger_es,
          action_es: step.action_es,
          reason_es: step.reason_es,
          step_type: step.step_type,
          classification: step.classification,
          confidence: 'INFERRED',
          rag_status: 'unknown',
          common_issues_es: step.common_issues_es,
          responsible_party_id: partyIdByKey.get(step.responsible_party_key) ?? null,
        },
      });
      stepIdByIndex.set(step.sequence_index, created.id);

      for (const inputName of step.inputs_es) {
        const ioId = await ensureIo(inputName);
        await tx.stepIo.create({ data: { step_id: created.id, io_item_id: ioId, role: 'input' } });
      }
      for (const outputName of step.outputs_es) {
        const ioId = await ensureIo(outputName);
        await tx.stepIo.create({ data: { step_id: created.id, io_item_id: ioId, role: 'output' } });
      }
      for (const doc of step.documents) {
        const docId = await ensureDoc(doc);
        // First document of an output-producing step is a 'produces'; default to 'references' otherwise.
        await tx.stepDocument.create({
          data: { step_id: created.id, document_id: docId, role: 'references' },
        });
      }
    }

    for (const handoff of SEED_HANDOFFS) {
      const fromId = stepIdByIndex.get(handoff.from_index);
      const toId = stepIdByIndex.get(handoff.to_index);
      if (!fromId || !toId) {
        throw new Error(`seed handoff references a missing step: ${handoff.from_index}->${handoff.to_index}`);
      }
      await tx.handoff.create({
        data: {
          process_id: process.id,
          from_step_id: fromId,
          to_step_id: toId,
          kind: handoff.kind,
          condition_es: handoff.condition_es ?? null,
          condition_en: handoff.condition_en ?? null,
        },
      });
    }

    logger.info(
      { process_id: process.id, steps: SEED_STEPS.length, handoffs: SEED_HANDOFFS.length, parties: SEED_PARTIES.length },
      'seed: INFERRED draft process created (all steps confidence=INFERRED, status=draft)',
    );
  });

  await disconnectDb();
}

main()
  .then(() => {
    logger.info('seed: complete');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ err: error }, 'seed: failed');
    process.exit(1);
  });
