import { useAppState } from '../../state/AppStateProvider';

const DENIED_HEADS = {
  both: 'Нет доступа к камере и микрофону',
  video: 'Нет доступа к камере',
  audio: 'Нет доступа к микрофону',
} as const;

/**
 * Постоянный баннер, пока браузер не даёт доступ к устройству (FR-33, US-12). Скрывается сам,
 * когда после разрешения в настройках сайта пользователь включит устройство тумблером.
 */
export function MediaAccessBanner() {
  const { localMedia } = useAppState();
  const audio = localMedia.audio === 'denied';
  const video = localMedia.video === 'denied';
  if (!audio && !video) return null;

  const head = DENIED_HEADS[audio && video ? 'both' : video ? 'video' : 'audio'];
  return (
    <section className="media-banner" aria-label="Нет доступа к устройствам">
      <strong>{head}.</strong> Разрешите доступ в настройках сайта (значок слева от адреса) и
      нажмите кнопку устройства
    </section>
  );
}
