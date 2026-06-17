// ai-gateway bus subscriptions (Rule 4). The gateway is the bus↔ICM adapter on the app side.
//
// freshness.scan_requested: emitted by platform-core's scheduler (the cron entry point) for each active
// process on a schedule, and also realisable on editor-open. The gateway consumes it, compiles a READ-only
// snapshot via the registry, runs the 02_sop_freshness specialist, and emits freshness.report_ready.
// This is the scheduled path; the route path (/freshness-scan) calls the same service method directly.
//
// The gateway subscribes to NO registry-write events and emits NO registry-write events — its only outbound
// events are interview.*/freshness.* (the AI-layer result events). The write-path boundary holds at the bus.

import type { AppContext } from '../../core/context.js';
import type { DomainEvent } from '../../core/events.js';
import type { AiGatewayService } from './service.js';

export function registerAiGatewaySubscriptions(ctx: AppContext, service: AiGatewayService): void {
  ctx.bus.subscribe('freshness.scan_requested', async (event: DomainEvent) => {
    const payload = event.payload as { process_id?: string; trigger?: string };
    if (!payload.process_id) return;
    // Avoid an infinite loop: only the scheduler/editor emit scan_requested; the gateway emits report_ready,
    // never scan_requested. The trigger tag distinguishes scheduled vs editor_opened.
    const trigger = payload.trigger === 'editor_opened' ? 'editor_opened' : 'scheduled';
    try {
      await service.runFreshnessScan(payload.process_id, trigger);
    } catch (error) {
      ctx.logger.error({ err: error, process_id: payload.process_id }, 'scheduled freshness scan failed');
    }
  });
}
