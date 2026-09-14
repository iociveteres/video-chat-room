import fc from 'fast-check';
import { describe, it } from 'vitest';
import { scenario } from './stand/commands';
import { RoleStand } from './stand/RoleStand';
import {
  checkNoLeaksOrGhosts,
  checkOneOfferAnswerPerPair,
  checkRoles,
  checkRoomLimit,
} from './stand/roleProperties';

/**
 * Один прогон — свой сервер, до 6 клиентов и до MAX_COMMANDS команд; в среднем ~0.1 с,
 * так что 100 прогонов укладываются в ~10 с. Глубокая проверка: ROLE_PROPERTY_RUNS=1000.
 */
const NUM_RUNS = Number(process.env.ROLE_PROPERTY_RUNS ?? 100);
const MAX_COMMANDS = 24;
const MAX_WAIT_MS = 30;

describe('role protocol (I1) under arbitrary interleavings', () => {
  // Худший прогон ~0.3 с; запас — на shrink: при падении fast-check перезапускает сценарии.
  it(
    'room limit, roles by joinSeq, one offer/answer per pair, no leaks or ghosts',
    { timeout: 180_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          scenario({ maxCommands: MAX_COMMANDS, maxWaitMs: MAX_WAIT_MS }),
          async ({ clients, commands }) => {
            const stand = await RoleStand.start(clients);
            try {
              await stand.run(commands);
              await stand.settle();
              // Четыре свойства на одном сценарии: отдельный прогон на каждое вчетверо дороже.
              checkRoomLimit(stand);
              checkRoles(stand);
              checkOneOfferAnswerPerPair(stand);
              checkNoLeaksOrGhosts(stand);
            } finally {
              await stand.close();
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
  );
});
