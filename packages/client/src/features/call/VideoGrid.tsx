import { MAX_PARTICIPANTS } from '@vcr/shared';
import type { CSSProperties } from 'react';
import { useAppState } from '../../state/AppStateProvider';
import { RemoteTile } from './RemoteTile';
import { SelfTile } from './SelfTile';

export interface GridLayout {
  cols: number;
  rows: number;
  /** Нечётная последняя плитка — по центру нижнего ряда. */
  lastRowCentered: boolean;
}

/** Раскладка по числу плиток вместе с self (TDD этапа 5 §4.1, PRD §6). */
export function getGridLayout(count: number): GridLayout {
  switch (Math.min(Math.max(count, 1), MAX_PARTICIPANTS)) {
    case 1:
      return { cols: 1, rows: 1, lastRowCentered: false };
    case 2:
      return { cols: 2, rows: 1, lastRowCentered: false };
    case 3:
      return { cols: 2, rows: 2, lastRowCentered: true };
    default:
      return { cols: 2, rows: 2, lastRowCentered: false };
  }
}

/**
 * Видеосетка 1–4 плитки. Self первой, затем удалённые в порядке participantIds (= joinedAt):
 * новые добавляются в конец, существующие не переставляются. Ключ — participantId, поэтому
 * вход и выход других не перемонтирует <video>, и звук не прерывается.
 */
export function VideoGrid() {
  const { participantIds, selfId } = useAppState();
  const remoteIds = participantIds.filter((id) => id !== selfId);
  const count = remoteIds.length + 1;
  const layout = getGridLayout(count);
  const style = { '--cols': layout.cols, '--rows': layout.rows } as CSSProperties;

  return (
    <section
      className="video-grid"
      aria-label="Видео"
      data-count={count}
      data-last-row-centered={layout.lastRowCentered}
      style={style}
    >
      <div className="video-grid__cell video-grid__cell--self">
        <SelfTile />
      </div>
      {remoteIds.map((id) => (
        <div key={id} className="video-grid__cell" data-participant-id={id}>
          <RemoteTile participantId={id} />
        </div>
      ))}
    </section>
  );
}
