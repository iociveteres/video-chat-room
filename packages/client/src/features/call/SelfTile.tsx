import { deviceStatusLabel } from '../../media/mediaTexts';
import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { selectSelf } from '../../state/selectors';
import { VideoTile } from './VideoTile';

/** Self-view: собственный previewStream без звука и зеркально, как в зеркале. */
export function SelfTile() {
  const state = useAppState();
  const session = useRoomSession();
  const { localMedia } = state;
  // Имя из сервера (нормализованное); до ack — введённое пользователем.
  const name = selectSelf(state)?.name ?? state.displayName ?? '';
  const showVideo = localMedia.video === 'on';

  return (
    <VideoTile
      name={name}
      label={name ? `${name} (вы)` : 'Вы'}
      stream={session.media.previewStream}
      streamVersion={localMedia.videoTrackVersion}
      showVideo={showVideo}
      audioMuted={localMedia.audio !== 'on'}
      muted
      mirrored
      statusLabel={showVideo ? undefined : deviceStatusLabel('video', localMedia.video)}
    />
  );
}
