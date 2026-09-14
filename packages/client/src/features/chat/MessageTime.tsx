import { formatTime } from './formatTime';

export interface MessageTimeProps {
  ts: number;
}

export function MessageTime({ ts }: MessageTimeProps) {
  return (
    <time className="message__time" dateTime={new Date(ts).toISOString()}>
      {formatTime(ts)}
    </time>
  );
}
