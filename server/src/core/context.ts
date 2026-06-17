// The shared application context — the single object every module receives to wire itself.
// Builders B and C register their module by exporting `register{Module}(app, ctx)` and calling it from index.ts;
// they read db / bus / logger / config from here and never construct their own singletons.

import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import type { EventBus } from './event-bus.js';
import type { Logger } from './logger.js';

export interface AppContext {
  config: AppConfig;
  db: Db;
  bus: EventBus;
  logger: Logger;
}
