// Append-only audit writer. Subscribes to ALL domain events ('*') and writes one audit_events row per event.
// audit_events is append-only — this module is its only writer, and RLS revokes UPDATE/DELETE at the DB level.
// No sensitive data is written: payloads from the bus are already domain-shaped (no password hashes/tokens).

import type { Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context.js';
import type { DomainEvent } from '../../core/events.js';

const SYSTEM_EVENT_PREFIXES = ['system.'];

function actorTypeFor(event: DomainEvent): string {
  if (event.event_type.startsWith('user.')) return 'user';
  if (SYSTEM_EVENT_PREFIXES.some((prefix) => event.event_type.startsWith(prefix))) return 'system';
  return 'module';
}

function entityTypeFor(event: DomainEvent): string {
  const [entity] = event.event_type.split('.');
  return entity ?? 'unknown';
}

export function registerAuditWriter(ctx: AppContext): void {
  ctx.bus.subscribe('*', async (event) => {
    const payload = event.payload as Record<string, unknown>;
    const actorId = typeof payload.actor_id === 'string' ? payload.actor_id : undefined;
    const entityId =
      typeof payload.entity_id === 'string'
        ? payload.entity_id
        : typeof payload.id === 'string'
          ? payload.id
          : undefined;

    await ctx.db.auditEvent.create({
      data: {
        event_type: event.event_type,
        actor_id: actorId ?? null,
        actor_type: actorTypeFor(event),
        entity_id: entityId ?? null,
        entity_type: entityTypeFor(event),
        payload: event.payload as Prisma.InputJsonValue,
        session_id: event.metadata.session_id ?? null,
      },
    });
  });
}
