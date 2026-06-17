// Freshness scheduler hook. The cron ENTRY POINT only — it emits `freshness.scan_requested` for each active
// process on a schedule. It makes NO AI calls and compiles NO snapshot here: ai-gateway (Builder B/C) consumes
// the event, the registry compiles the snapshot, and the ICM layer does the scanning. platform-core only ticks.
//
// Uses croner (a small, maintained, dependency-free cron library). Disabled via FRESHNESS_CRON_ENABLED=false.

import { Cron } from 'croner';
import type { AppContext } from '../../core/context.js';

const SOURCE_NODE = 'platform-core';

export class FreshnessScheduler {
  private job: Cron | null = null;

  constructor(private readonly ctx: AppContext) {}

  start(): void {
    if (!this.ctx.config.FRESHNESS_CRON_ENABLED) {
      this.ctx.logger.info('freshness scheduler disabled (FRESHNESS_CRON_ENABLED=false)');
      return;
    }
    this.job = new Cron(this.ctx.config.FRESHNESS_CRON, () => {
      void this.tick();
    });
    this.ctx.logger.info(
      { cron: this.ctx.config.FRESHNESS_CRON },
      'freshness scheduler started',
    );
  }

  stop(): void {
    this.job?.stop();
    this.job = null;
  }

  private async tick(): Promise<void> {
    try {
      const processes = await this.ctx.db.process.findMany({
        where: { status: 'active', is_archived: false },
        select: { id: true },
      });
      for (const process of processes) {
        await this.ctx.bus.emit(
          'freshness.scan_requested',
          { process_id: process.id, trigger: 'scheduled' },
          { source_node: SOURCE_NODE, metadata: { triggered_by: 'system.scheduled_scan' } },
        );
      }
      this.ctx.logger.info({ count: processes.length }, 'freshness scans requested (scheduled)');
    } catch (error) {
      this.ctx.logger.error({ err: error }, 'freshness scheduler tick failed');
    }
  }
}
