import { DIAGNOSTICS_INTERVAL_MS, type ParticipantDTO, type SignalData } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsSlot, isDiagnosticsRequested } from '../src/features/call/DiagnosticsSlot';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

const media = { audio: true, video: true };
const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 2_000, media };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 1_000, media };
const OFFER: SignalData = { type: 'offer', sdp: fakeOfferSdp() };

/** Отчёт getStats пары с Марией: timestamp и счётчики растут от замера к замеру. */
function statsReport(n: number): RTCStatsReport {
  const entries = [
    { id: 'cp', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.004 },
    {
      id: 'in',
      type: 'inbound-rtp',
      kind: 'video',
      timestamp: 1_000 + n * DIAGNOSTICS_INTERVAL_MS,
      bytesReceived: n * 250_000,
      jitterBufferDelay: n * 3,
      jitterBufferEmittedCount: n * 50,
      framesPerSecond: 24,
    },
    {
      id: 'out',
      type: 'outbound-rtp',
      kind: 'video',
      timestamp: 1_000 + n * DIAGNOSTICS_INTERVAL_MS,
      bytesSent: n * 125_000,
      framesPerSecond: 23,
      qualityLimitationReason: 'bandwidth',
    },
  ];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

async function renderSlot(search: string) {
  const socket = new FakeSocket();
  let session: RoomSession | undefined;
  const view = render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: fakeMedia().createMedia,
          createPeers: fakePeers().createPeers,
        }))
      }
    >
      <DiagnosticsSlot search={search} />
    </AppStateProvider>,
  );

  await act(async () => {
    session!.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [maria, alex], messages: [] });
  });
  return { session: session!, socket, unmount: view.unmount };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isDiagnosticsRequested', () => {
  it.each([
    ['?debug=1', true],
    ['?room=x&debug=1', true],
    ['', false],
    ['?debug=0', false],
    ['?debug', false],
  ])('%j → %s', (search, expected) => {
    expect(isDiagnosticsRequested(search)).toBe(expected);
  });
});

describe('DiagnosticsSlot', () => {
  it('renders nothing without ?debug=1', async () => {
    await renderSlot('');
    await act(() => flushMicrotasks());

    expect(screen.queryByRole('complementary', { name: 'Диагностика' })).toBeNull();
  });

  it('?debug=1: a row per pair with role, status and metrics, refreshed every interval', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { session, socket } = await renderSlot('?debug=1');
    const overlay = await screen.findByRole('complementary', { name: 'Диагностика' });
    expect(overlay).toHaveTextContent('Нет медиасоединений');

    let n = 0;
    const getStats = vi
      .spyOn(session.peers, 'getStats')
      .mockImplementation(() => Promise.resolve(statsReport(++n)));
    await act(async () => {
      socket.serverEmit('signal', { from: maria.id, data: OFFER });
      await vi.advanceTimersByTimeAsync(DIAGNOSTICS_INTERVAL_MS);
    });

    const row = () => within(overlay).getByRole('row', { name: /Мария/ });
    expect(row()).toHaveAttribute('data-participant-id', maria.id);
    expect(row()).toHaveTextContent('← answer');
    expect(row()).toHaveTextContent('connecting');
    expect(row()).toHaveTextContent('4 мс');
    expect(row()).toHaveTextContent('60 мс');
    expect(row()).toHaveTextContent('24 / 23');
    expect(row()).toHaveTextContent('— / —');
    expect(row()).toHaveTextContent('bandwidth');

    // Второй замер: битрейт по разнице байт за интервал.
    await act(() => vi.advanceTimersByTimeAsync(DIAGNOSTICS_INTERVAL_MS));
    expect(row()).toHaveTextContent('1000 / 500');
    expect(getStats).toHaveBeenCalledWith(maria.id);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { session, unmount } = await renderSlot('?debug=1');
    await screen.findByRole('complementary', { name: 'Диагностика' });
    const summary = vi.spyOn(session.peers, 'getSummary');
    await act(() => vi.advanceTimersByTimeAsync(DIAGNOSTICS_INTERVAL_MS));
    expect(summary).toHaveBeenCalledOnce();

    unmount();
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_INTERVAL_MS * 3);

    expect(summary).toHaveBeenCalledOnce();
  });
});
