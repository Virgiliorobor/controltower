// process-registry bus subscriptions (Rule 4). The registry consumes documents' events so it can react to
// storage lifecycle, but it NEVER auto-creates a step↔document link from an event — that link is an editor
// action (POST /api/v1/steps/:id/documents). file.uploaded here is informational: it lets the registry log
// that an uploaded document exists and is available to attach; attachment stays a human decision (DC-5).
//
// freshness.report_ready is consumed as a RAG recompute HINT: a freshness scan can change a step's effective
// staleness, so the registry recomputes the scanned process's RAG. The report itself is suggestion-only and
// never edits the registry — only the derived rag_status (already the registry's own derived field) refreshes.

import type { AppContext } from '../../core/context.js';
import type { DomainEvent } from '../../core/events.js';
import type { ProcessRegistryService } from './service.js';

export function registerProcessRegistrySubscriptions(ctx: AppContext, service: ProcessRegistryService): void {
  // A document finished uploading. The registry does not link it (that is editor-driven); it just notes it.
  ctx.bus.subscribe('file.uploaded', (event: DomainEvent) => {
    const payload = event.payload as { id?: string; name?: string };
    ctx.logger.info(
      { document_id: payload.id, name: payload.name },
      'process-registry: document available to attach (link is editor-driven)',
    );
  });

  // A freshness report landed → recompute the scanned process's derived RAG (hint only; no content edits).
  ctx.bus.subscribe('freshness.report_ready', async (event: DomainEvent) => {
    const payload = event.payload as { process_id?: string };
    if (payload.process_id) {
      await service.recomputeProcessRag(payload.process_id);
    }
  });
}
