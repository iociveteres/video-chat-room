import { MAX_PARTICIPANTS } from '@vcr/shared';
import fc from 'fast-check';
import type { ClientCommand, Command } from './RoleStand';

/** K ∈ [2..6]: и комнаты с запасом, и переполнение сверх лимита на 1–2 участника. */
export const MIN_CLIENTS = 2;
export const MAX_CLIENTS = MAX_PARTICIPANTS + 2;

export interface Scenario {
  clients: number;
  commands: Command[];
}

export interface ScenarioOptions {
  maxCommands: number;
  maxWaitMs: number;
}

function clientCommand(clients: number): fc.Arbitrary<ClientCommand> {
  const client = fc.integer({ min: 0, max: clients - 1 });
  const of = (type: ClientCommand['type']) =>
    client.map((c): ClientCommand => ({ type, client: c }));
  return fc.oneof(
    // Входов больше, чем выходов: иначе комната почти всегда полупустая и лимит не достигается.
    { weight: 6, arbitrary: of('join') },
    { weight: 1, arbitrary: of('leave') },
    { weight: 1, arbitrary: of('disconnect') },
    { weight: 1, arbitrary: of('rejoin') },
  );
}

function command(clients: number, maxWaitMs: number): fc.Arbitrary<Command> {
  const wait = fc.integer({ min: 0, max: maxWaitMs }).map((ms): Command => ({ type: 'wait', ms }));
  // Несколько команд в одном синхронном блоке: одновременные входы и выходы.
  const tick = fc
    .array(clientCommand(clients), { minLength: 2, maxLength: 4 })
    .map((commands): Command => ({ type: 'tick', commands }));
  return fc.oneof(
    { weight: 4, arbitrary: clientCommand(clients) },
    { weight: 3, arbitrary: wait },
    { weight: 3, arbitrary: tick },
  );
}

/**
 * Сценарий: число клиентов K ∈ [2..6] и последовательность команд для них.
 *
 * Веса подобраны по статистике 200 сценариев: при равномерном K и коротких последовательностях
 * комната заполнялась в 13% прогонов, ROOM_FULL — в 3.5%. Со смещением K к 5–6 и size: 'medium'
 * — 42% и 23%, при этом выходы и повторные входы закрывают ~40% созданных сессий.
 */
export function scenario({ maxCommands, maxWaitMs }: ScenarioOptions): fc.Arbitrary<Scenario> {
  // ROOM_FULL возможен только при K > 4.
  const clientCount = fc.oneof(
    { weight: 1, arbitrary: fc.integer({ min: MIN_CLIENTS, max: MAX_PARTICIPANTS }) },
    { weight: 2, arbitrary: fc.integer({ min: MAX_PARTICIPANTS + 1, max: MAX_CLIENTS }) },
  );
  return clientCount.chain((clients) =>
    fc.record({
      clients: fc.constant(clients),
      commands: fc.array(command(clients, maxWaitMs), {
        minLength: 1,
        maxLength: maxCommands,
        size: 'medium',
      }),
    }),
  );
}
