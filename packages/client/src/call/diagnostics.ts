/**
 * Метрики пары из getStats() для DiagnosticsOverlay (TDD этапа 5 §4.4, §9.2). Только расчёт:
 * данные не хранятся, кроме предыдущего замера для дельт.
 */

/** Задержка захвата и рендера, которую getStats не видит (TDD этапа 5 §9.2). */
export const CAPTURE_RENDER_DELAY_MS = 100;

/** Накопительные счётчики видео пары: из разницы двух замеров считаются текущие значения. */
export interface VideoStatsSample {
  inboundTimestamp: number;
  outboundTimestamp: number;
  bytesReceived: number;
  bytesSent: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  totalProcessingDelay: number;
  framesDecoded: number;
}

export interface PairDiagnostics {
  rttMs: number | null;
  jitterBufferMs: number | null;
  processingMs: number | null;
  /** Оценка glass-to-glass: RTT/2 + jitter buffer + обработка + захват и рендер. */
  latencyEstimateMs: number | null;
  fpsIn: number | null;
  fpsOut: number | null;
  bitrateInKbps: number | null;
  bitrateOutKbps: number | null;
  /** Chromium: none / cpu / bandwidth / other. */
  qualityLimitationReason: string | null;
}

type StatsEntry = Record<string, unknown> & { id: string; type: string };

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Среднее за интервал: Δ суммы / Δ счётчика; без предыдущего замера — за всё время. */
function averageMs(total: number, count: number, prevTotal = 0, prevCount = 0): number | null {
  const delta = count - prevCount;
  if (delta > 0) return ((total - prevTotal) / delta) * 1000;
  return count > 0 ? (total / count) * 1000 : null;
}

function kbps(bytes: number, timestamp: number, prevBytes?: number, prevTimestamp?: number) {
  // Нулевая метка — в прошлом замере этого потока ещё не было.
  if (prevBytes === undefined || !prevTimestamp) return null;
  const seconds = (timestamp - prevTimestamp) / 1000;
  return seconds > 0 ? ((bytes - prevBytes) * 8) / seconds / 1000 : null;
}

/** Выбранная ICE-пара: через transport, иначе succeeded + nominated, иначе любая succeeded. */
function selectedCandidatePair(entries: StatsEntry[]): StatsEntry | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const transport = entries.find((entry) => entry.type === 'transport');
  const selectedId = transport?.selectedCandidatePairId;
  if (typeof selectedId === 'string' && byId.has(selectedId)) return byId.get(selectedId);
  const succeeded = entries.filter(
    (entry) => entry.type === 'candidate-pair' && entry.state === 'succeeded',
  );
  return succeeded.find((entry) => entry.nominated === true) ?? succeeded[0];
}

export function diagnosePair(
  stats: Iterable<RTCStats>,
  previous: VideoStatsSample | null,
): { diagnostics: PairDiagnostics; sample: VideoStatsSample | null } {
  const entries = [...stats] as unknown as StatsEntry[];
  const video = (type: string) =>
    entries.find((entry) => entry.type === type && entry.kind === 'video');
  const inbound = video('inbound-rtp');
  const outbound = video('outbound-rtp');

  const rtt = num(selectedCandidatePair(entries)?.currentRoundTripTime);
  const rttMs = rtt === null ? null : rtt * 1000;

  const sample: VideoStatsSample | null =
    inbound || outbound
      ? {
          inboundTimestamp: num(inbound?.timestamp) ?? 0,
          outboundTimestamp: num(outbound?.timestamp) ?? 0,
          bytesReceived: num(inbound?.bytesReceived) ?? 0,
          bytesSent: num(outbound?.bytesSent) ?? 0,
          jitterBufferDelay: num(inbound?.jitterBufferDelay) ?? 0,
          jitterBufferEmittedCount: num(inbound?.jitterBufferEmittedCount) ?? 0,
          totalProcessingDelay: num(inbound?.totalProcessingDelay) ?? 0,
          framesDecoded: num(inbound?.framesDecoded) ?? 0,
        }
      : null;

  const jitterBufferMs =
    inbound && sample
      ? averageMs(
          sample.jitterBufferDelay,
          sample.jitterBufferEmittedCount,
          previous?.jitterBufferDelay,
          previous?.jitterBufferEmittedCount,
        )
      : null;
  // totalProcessingDelay есть только в Chromium.
  const processingMs =
    inbound && sample && num(inbound.totalProcessingDelay) !== null
      ? averageMs(
          sample.totalProcessingDelay,
          sample.framesDecoded,
          previous?.totalProcessingDelay,
          previous?.framesDecoded,
        )
      : null;

  const latencyEstimateMs =
    rttMs !== null && jitterBufferMs !== null
      ? rttMs / 2 + jitterBufferMs + (processingMs ?? 0) + CAPTURE_RENDER_DELAY_MS
      : null;

  const reason = outbound?.qualityLimitationReason;
  return {
    sample,
    diagnostics: {
      rttMs,
      jitterBufferMs,
      processingMs,
      latencyEstimateMs,
      fpsIn: num(inbound?.framesPerSecond),
      fpsOut: num(outbound?.framesPerSecond),
      bitrateInKbps:
        inbound && sample
          ? kbps(
              sample.bytesReceived,
              sample.inboundTimestamp,
              previous?.bytesReceived,
              previous?.inboundTimestamp,
            )
          : null,
      bitrateOutKbps:
        outbound && sample
          ? kbps(
              sample.bytesSent,
              sample.outboundTimestamp,
              previous?.bytesSent,
              previous?.outboundTimestamp,
            )
          : null,
      qualityLimitationReason: typeof reason === 'string' ? reason : null,
    },
  };
}
