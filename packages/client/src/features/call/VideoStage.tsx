import { SelfTile } from './SelfTile';

/** Область видео комнаты. Этап 3 — только self-view; сетка участников появится на этапах 4–5. */
export function VideoStage() {
  return (
    <section className="video-stage" aria-label="Видео">
      <SelfTile />
    </section>
  );
}
