import { describe, expect, it } from 'vitest';
import { CAPTURE_RENDER_DELAY_MS, diagnosePair } from '../src/call/diagnostics';

type Stat = Record<string, unknown> & { id: string; type: string };

const pair = (id: string, rtt: number, extra: Record<string, unknown> = {}): Stat => ({
  id,
  type: 'candidate-pair',
  state: 'succeeded',
  currentRoundTripTime: rtt,
  ...extra,
});

const inbound = (extra: Record<string, unknown> = {}): Stat => ({
  id: 'in-v',
  type: 'inbound-rtp',
  kind: 'video',
  timestamp: 10_000,
  bytesReceived: 100_000,
  jitterBufferDelay: 4,
  jitterBufferEmittedCount: 100,
  totalProcessingDelay: 1,
  framesDecoded: 100,
  framesPerSecond: 24,
  ...extra,
});

const outbound = (extra: Record<string, unknown> = {}): Stat => ({
  id: 'out-v',
  type: 'outbound-rtp',
  kind: 'video',
  timestamp: 10_000,
  bytesSent: 200_000,
  framesPerSecond: 23,
  qualityLimitationReason: 'none',
  ...extra,
});

const run = (stats: Stat[], previous: Parameters<typeof diagnosePair>[1] = null) =>
  diagnosePair(stats as unknown as RTCStats[], previous);

describe('diagnosePair', () => {
  it('first sample: cumulative delays, RTT of the selected pair, no bitrate yet', () => {
    const { diagnostics, sample } = run([
      { id: 't', type: 'transport', selectedCandidatePairId: 'cp-2' },
      pair('cp-1', 0.5, { nominated: true }),
      pair('cp-2', 0.02),
      inbound(),
      outbound(),
      // Аудио не смешивается с видео.
      { id: 'in-a', type: 'inbound-rtp', kind: 'audio', framesPerSecond: 99 },
    ]);

    expect(diagnostics).toEqual({
      rttMs: 20,
      jitterBufferMs: 40,
      processingMs: 10,
      latencyEstimateMs: 20 / 2 + 40 + 10 + CAPTURE_RENDER_DELAY_MS,
      fpsIn: 24,
      fpsOut: 23,
      bitrateInKbps: null,
      bitrateOutKbps: null,
      qualityLimitationReason: 'none',
    });
    expect(sample).toMatchObject({ bytesReceived: 100_000, bytesSent: 200_000 });
  });

  it('next sample: bitrate and delays over the interval, not since the start', () => {
    const first = run([pair('cp', 0.01), inbound(), outbound()]).sample;

    const { diagnostics } = run(
      [
        pair('cp', 0.01),
        inbound({
          timestamp: 12_000,
          bytesReceived: 350_000,
          jitterBufferDelay: 7,
          jitterBufferEmittedCount: 150,
          totalProcessingDelay: 2,
          framesDecoded: 150,
        }),
        outbound({ timestamp: 12_000, bytesSent: 450_000, qualityLimitationReason: 'cpu' }),
      ],
      first,
    );

    // 250 000 байт за 2 с = 1000 kbps; (7 − 4) с на 50 кадров = 60 мс; (2 − 1) / 50 = 20 мс.
    expect(diagnostics).toMatchObject({
      bitrateInKbps: 1000,
      bitrateOutKbps: 1000,
      jitterBufferMs: 60,
      processingMs: 20,
      qualityLimitationReason: 'cpu',
    });
  });

  it('falls back to a nominated, then any succeeded candidate pair', () => {
    const nominated = run([pair('a', 0.3), pair('b', 0.04, { nominated: true })]);
    const any = run([{ ...pair('a', 0.3), state: 'failed' }, pair('b', 0.05)]);

    expect(nominated.diagnostics.rttMs).toBe(40);
    expect(any.diagnostics.rttMs).toBe(50);
  });

  it('Firefox without totalProcessingDelay: no processing delay, latency still estimated', () => {
    const { diagnostics } = run([pair('cp', 0.01), inbound({ totalProcessingDelay: undefined })]);

    expect(diagnostics.processingMs).toBeNull();
    expect(diagnostics.latencyEstimateMs).toBe(5 + 40 + CAPTURE_RENDER_DELAY_MS);
    expect(diagnostics.bitrateOutKbps).toBeNull();
    expect(diagnostics.qualityLimitationReason).toBeNull();
  });

  it('no media and no connected pair yet: all metrics are empty', () => {
    const { diagnostics, sample } = run([
      { id: 'cp', type: 'candidate-pair', state: 'in-progress' },
    ]);

    expect(sample).toBeNull();
    expect(Object.values(diagnostics).every((value) => value === null)).toBe(true);
  });

  it('a stream missing in the previous sample does not produce a bitrate', () => {
    const first = run([outbound()]).sample;
    const { diagnostics } = run(
      [inbound({ timestamp: 12_000 }), outbound({ timestamp: 12_000 })],
      first,
    );

    expect(diagnostics.bitrateInKbps).toBeNull();
    expect(diagnostics.bitrateOutKbps).toBe(0);
    // Декодированных кадров в интервале нет — среднее за всё время.
    expect(diagnostics.jitterBufferMs).toBe(40);
  });
});
