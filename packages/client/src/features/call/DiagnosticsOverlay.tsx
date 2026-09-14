import { DIAGNOSTICS_INTERVAL_MS } from '@vcr/shared';
import { useEffect, useState } from 'react';
import { diagnosePair, type PairDiagnostics, type VideoStatsSample } from '../../call/diagnostics';
import type { PeerSummary } from '../../call/PeerManager';
import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import './DiagnosticsOverlay.css';

export interface DiagnosticsRow extends PeerSummary {
  diagnostics: PairDiagnostics;
}

const PEER_ROLE_TEXT = { offerer: 'offer →', answerer: '← answer' } as const;

const format = (value: number | null, unit = '') =>
  value === null ? '—' : `${Math.round(value)}${unit}`;

/**
 * Метрики пар из getStats() раз в DIAGNOSTICS_INTERVAL_MS (TDD этапа 5 §4.4). Только dev и E2E:
 * подключается через DiagnosticsSlot по ?debug=1, в prod-сборку не попадает.
 */
export default function DiagnosticsOverlay() {
  const session = useRoomSession();
  const { participantsById } = useAppState();
  const [rows, setRows] = useState<DiagnosticsRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    // Предыдущий замер по участнику — только для дельт битрейта и задержек.
    const previous = new Map<string, VideoStatsSample | null>();

    const poll = async () => {
      // Медленный getStats не должен накапливать параллельные опросы.
      if (running) return;
      running = true;
      try {
        const summary = session.peers.getSummary();
        const next = await Promise.all(
          summary.map(async (peer) => {
            const report = await session.peers.getStats(peer.participantId);
            const { diagnostics, sample } = diagnosePair(
              report?.values() ?? [],
              previous.get(peer.participantId) ?? null,
            );
            previous.set(peer.participantId, sample);
            return { ...peer, diagnostics };
          }),
        );
        const live = new Set(summary.map((peer) => peer.participantId));
        for (const id of previous.keys()) if (!live.has(id)) previous.delete(id);
        if (!cancelled) setRows(next);
      } finally {
        running = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), DIAGNOSTICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session]);

  return (
    <aside className="diagnostics" aria-label="Диагностика">
      <table>
        <thead>
          <tr>
            <th scope="col">Участник</th>
            <th scope="col">Роль</th>
            <th scope="col">Статус</th>
            <th scope="col">RTT</th>
            <th scope="col">Jitter buf.</th>
            <th scope="col">Обработка</th>
            <th scope="col">Задержка ≈</th>
            <th scope="col">FPS вх/исх</th>
            <th scope="col">kbps вх/исх</th>
            <th scope="col">Ограничение</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={10}>Нет медиасоединений</td>
            </tr>
          )}
          {rows.map(({ participantId, role, status, diagnostics: d }) => (
            <tr key={participantId} data-participant-id={participantId}>
              <th scope="row">{participantsById[participantId]?.name ?? participantId}</th>
              <td>{PEER_ROLE_TEXT[role]}</td>
              <td>{status}</td>
              <td>{format(d.rttMs, ' мс')}</td>
              <td>{format(d.jitterBufferMs, ' мс')}</td>
              <td>{format(d.processingMs, ' мс')}</td>
              <td>{format(d.latencyEstimateMs, ' мс')}</td>
              <td>
                {format(d.fpsIn)} / {format(d.fpsOut)}
              </td>
              <td>
                {format(d.bitrateInKbps)} / {format(d.bitrateOutKbps)}
              </td>
              <td>{d.qualityLimitationReason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
