import { useAppState } from '../../state/AppStateProvider';
import { RemoteTile } from './RemoteTile';
import { SelfTile } from './SelfTile';

/**
 * Область видео комнаты. Этап 4 — self-view и плитки удалённых участников в flex-ряд
 * (сетка 1–4 — этап 5). Ключ — participantId: смена статуса не перемонтирует <video>.
 */
export function VideoStage() {
  const { participantIds, selfId } = useAppState();

  return (
    <section className="video-stage" aria-label="Видео">
      <SelfTile />
      {participantIds
        .filter((id) => id !== selfId)
        .map((id) => (
          <RemoteTile key={id} participantId={id} />
        ))}
    </section>
  );
}
