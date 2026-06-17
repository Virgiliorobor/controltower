// In-process typed EventBus backed by a Postgres event_outbox (durable across restarts).
// Selected per technical.md ("simple unless >3 functions / cross-service"): one process, in-process delivery,
// outbox table for restart recovery and the append-only audit feed. Upgrade path: swap the broker for
// BullMQ+Redis when a second service appears — consumers (subscribers) are unchanged.
//
// Flow on emit():
//   1. Persist the event to event_outbox (status=pending) — durability first.
//   2. Deliver in-process to all subscribers of that event_type and to wildcard ('*') subscribers.
//   3. Mark the outbox row delivered (or dead after retries on dispatch).
// Subscribers never throw to the emitter: a subscriber error is logged and isolated (fire-and-forget,
// per the architecture spec) so one bad consumer cannot break a domain write.

import type { Prisma } from '@prisma/client';
import type { Db } from './db.js';
import type { Logger } from './logger.js';
import { buildEvent, type DomainEvent, type EmitOptions, type EventType } from './events.js';

export type EventHandler<TPayload = Record<string, unknown>> = (
  event: DomainEvent<TPayload>,
) => void | Promise<void>;

interface Subscription {
  eventType: EventType | '*';
  handler: EventHandler;
}

const MAX_DISPATCH_RETRIES = 3;

export class EventBus {
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  subscribe<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    eventType: EventType | '*',
    handler: EventHandler<TPayload>,
  ): void {
    this.subscriptions.push({ eventType, handler: handler as EventHandler });
  }

  async emit<TPayload extends Record<string, unknown>>(
    eventType: EventType,
    payload: TPayload,
    options: EmitOptions,
  ): Promise<DomainEvent<TPayload>> {
    const event = buildEvent(eventType, payload, options);

    await this.db.eventOutbox.create({
      data: {
        id: event.event_id,
        event_type: event.event_type,
        source_node: event.source_node,
        payload: event.payload as Prisma.InputJsonValue,
        metadata: event.metadata as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });

    await this.dispatch(event);
    return event;
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    const matched = this.subscriptions.filter(
      (sub) => sub.eventType === '*' || sub.eventType === event.event_type,
    );

    const results = await Promise.allSettled(matched.map((sub) => sub.handler(event)));

    let allDelivered = true;
    for (const result of results) {
      if (result.status === 'rejected') {
        allDelivered = false;
        this.logger.error(
          { event_type: event.event_type, event_id: event.event_id, err: result.reason },
          'event subscriber failed',
        );
      }
    }

    await this.db.eventOutbox.update({
      where: { id: event.event_id },
      data: allDelivered
        ? { status: 'delivered', delivered_at: new Date() }
        : { status: 'pending' },
    });
  }

  // Restart recovery: redeliver any events that were persisted but not delivered before a crash/redeploy.
  async recoverPending(): Promise<number> {
    const pending = await this.db.eventOutbox.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
      take: 500,
    });

    let recovered = 0;
    for (const row of pending) {
      const event: DomainEvent = {
        event_id: row.id,
        event_type: row.event_type as EventType,
        timestamp: row.created_at.toISOString(),
        source_node: row.source_node,
        payload: row.payload as Record<string, unknown>,
        metadata: row.metadata as unknown as DomainEvent['metadata'],
      };

      if (row.retries >= MAX_DISPATCH_RETRIES) {
        await this.db.eventOutbox.update({ where: { id: row.id }, data: { status: 'dead' } });
        this.logger.warn({ event_id: row.id }, 'outbox event marked dead after max retries');
        continue;
      }

      await this.db.eventOutbox.update({
        where: { id: row.id },
        data: { retries: { increment: 1 } },
      });
      await this.dispatch(event);
      recovered += 1;
    }
    return recovered;
  }
}
