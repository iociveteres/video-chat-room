import { act, render, screen } from '@testing-library/react';
import type { Dispatch } from 'react';
import { describe, expect, it } from 'vitest';
import { MediaAccessBanner } from '../src/features/room/MediaAccessBanner';
import type { DeviceStatus } from '../src/media/MediaController';
import { RoomSession } from '../src/session/RoomSession';
import type { AppAction } from '../src/state/actions';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia } from './helpers/FakeMedia';
import { FakeSocket } from './helpers/FakeSocket';

function renderBanner() {
  let dispatch: Dispatch<AppAction> | undefined;
  render(
    <AppStateProvider
      createSession={(d) => {
        dispatch = d;
        return new RoomSession({
          dispatch: d,
          createSocket: () => new FakeSocket().asSocket(),
          createMedia: fakeMedia().createMedia,
        });
      }}
    >
      <MediaAccessBanner />
    </AppStateProvider>,
  );
  const setStatuses = (audio: DeviceStatus, video: DeviceStatus) =>
    act(() => {
      dispatch!({ type: 'LOCAL_MEDIA_STATUS_CHANGED', kind: 'audio', status: audio });
      dispatch!({ type: 'LOCAL_MEDIA_STATUS_CHANGED', kind: 'video', status: video });
    });
  const banner = () => screen.queryByRole('region', { name: 'Нет доступа к устройствам' });
  return { setStatuses, banner };
}

describe('MediaAccessBanner', () => {
  it.each<[DeviceStatus, DeviceStatus, string]>([
    ['denied', 'denied', 'Нет доступа к камере и микрофону.'],
    ['on', 'denied', 'Нет доступа к камере.'],
    ['denied', 'not-found', 'Нет доступа к микрофону.'],
  ])('audio=%s video=%s → «%s» with instructions', (audio, video, head) => {
    const t = renderBanner();

    t.setStatuses(audio, video);

    expect(t.banner()).toHaveTextContent(head);
    expect(t.banner()).toHaveTextContent(
      'Разрешите доступ в настройках сайта (значок слева от адреса) и нажмите кнопку устройства',
    );
  });

  it.each<[DeviceStatus, DeviceStatus]>([
    ['on', 'on'],
    ['off', 'off'],
    ['busy', 'not-found'],
    ['lost', 'failed'],
  ])('is hidden for audio=%s video=%s', (audio, video) => {
    const t = renderBanner();
    t.setStatuses(audio, video);
    expect(t.banner()).toBeNull();
  });

  it('stays until the device is turned on, then disappears', () => {
    const t = renderBanner();
    t.setStatuses('denied', 'denied');
    expect(t.banner()).not.toBeNull();

    t.setStatuses('acquiring', 'denied');
    expect(t.banner()).toHaveTextContent('Нет доступа к камере.');

    t.setStatuses('on', 'on');
    expect(t.banner()).toBeNull();
  });
});
