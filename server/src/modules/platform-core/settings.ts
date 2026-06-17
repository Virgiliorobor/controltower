// app_settings service. Typed accessors for the system settings the registry and AI layer read:
// default_language, stale_days, soon_days, interview_turn_budget. platform-core is the only writer.
// Defaults are seeded by the seed script; this service is the read/write boundary other modules use
// (they call getSettings(), never read app_settings directly).

import { z } from 'zod';
import type { AppContext } from '../../core/context.js';

export const SETTINGS_KEY = 'system';

export const settingsSchema = z.object({
  default_language: z.enum(['es', 'en']).default('es'),
  stale_days: z.number().int().positive().default(180),
  soon_days: z.number().int().positive().default(150),
  interview_turn_budget: z.number().int().positive().default(30),
});

export type SystemSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: SystemSettings = settingsSchema.parse({});

export class SettingsService {
  constructor(private readonly ctx: AppContext) {}

  async get(): Promise<SystemSettings> {
    const row = await this.ctx.db.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) {
      return DEFAULT_SETTINGS;
    }
    return settingsSchema.parse(row.value_json);
  }

  async update(patch: Partial<SystemSettings>, updatedBy?: string): Promise<SystemSettings> {
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, ...patch });
    await this.ctx.db.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value_json: next, updated_by: updatedBy ?? null },
      update: { value_json: next, updated_by: updatedBy ?? null },
    });
    return next;
  }

  async ensureDefaults(): Promise<void> {
    await this.ctx.db.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value_json: DEFAULT_SETTINGS },
      update: {},
    });
  }
}
