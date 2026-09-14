import type { MediaState } from '@vcr/shared';
import type { PeerStatus } from '../../call/PeerSession';
import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { useAutoplayRegistry } from './AutoplayGuard';
import { VideoTile } from './VideoTile';

export const PEER_STATUS_TEXT = {
  connecting: 'Подключение…',
  unstable: 'Связь нестабильна…',
  failed: 'Не удалось установить медиасоединение',
  cameraOff: 'Камера выключена',
} as const;

export interface RemoteTileView {
  showVideo: boolean;
  /** Подпись в заглушке, когда видео нет. */
  statusLabel?: string;
  /** Подпись поверх видео, когда оно показано (связь нестабильна). */
  overlayLabel?: string;
}

/**
 * Что показывает удалённая плитка (TDD этапа 4 §8.1). Видео — только при живом соединении
 * и включённой камере; при unstable остаётся последнее состояние с предупреждением поверх.
 */
export function remoteTileView(status: PeerStatus | undefined, media: MediaState): RemoteTileView {
  switch (status) {
    case 'connected':
      return media.video
        ? { showVideo: true }
        : { showVideo: false, statusLabel: PEER_STATUS_TEXT.cameraOff };
    case 'unstable':
      return media.video
        ? { showVideo: true, overlayLabel: PEER_STATUS_TEXT.unstable }
        : { showVideo: false, statusLabel: PEER_STATUS_TEXT.unstable };
    case 'failed':
      return { showVideo: false, statusLabel: PEER_STATUS_TEXT.failed };
    default:
      // connecting; closed и отсутствие записи бывают только мгновение до удаления плитки.
      return { showVideo: false, statusLabel: PEER_STATUS_TEXT.connecting };
  }
}

export interface RemoteTileProps {
  participantId: string;
}

/** Плитка удалённого участника: его видео и звук из PeerManager, без зеркала и со звуком. */
export function RemoteTile({ participantId }: RemoteTileProps) {
  const state = useAppState();
  const session = useRoomSession();
  const autoplay = useAutoplayRegistry();
  const participant = state.participantsById[participantId];
  if (!participant) return null;

  const view = remoteTileView(state.peers[participantId]?.status, participant.media);
  // Стабильный объект на всё время жизни пары; до offer сессии нет — null.
  const stream = session.peers.getRemoteStream(participantId);

  return (
    <VideoTile
      name={participant.name}
      stream={stream}
      showVideo={view.showVideo}
      audioMuted={!participant.media.audio}
      statusLabel={view.statusLabel}
      overlayLabel={view.overlayLabel}
      registerVideo={autoplay?.register}
      waitForFreshFrame
    />
  );
}
