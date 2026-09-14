import { Fragment, memo, useMemo } from 'react';
import { linkify, type TextSegment } from './linkify';

export interface MessageTextProps {
  text: string;
}

/** Сегменты с позицией начала в тексте: она уникальна и служит ключом. */
function segmentsWithOffsets(text: string): (TextSegment & { start: number })[] {
  let start = 0;
  return linkify(text).map((segment) => {
    const withOffset = { ...segment, start };
    start += segment.value.length;
    return withOffset;
  });
}

/**
 * Текст сообщения: обычные фрагменты — текстовые узлы React (разметка экранируется, FR-39),
 * http(s)-ссылки — `<a>` через JSX, без innerHTML (TDD v2 §4.3.3).
 */
export const MessageText = memo(function MessageText({ text }: MessageTextProps) {
  const segments = useMemo(() => segmentsWithOffsets(text), [text]);
  return (
    <>
      {segments.map((segment) =>
        segment.kind === 'text' ? (
          <Fragment key={segment.start}>{segment.value}</Fragment>
        ) : (
          <a
            key={segment.start}
            href={segment.href}
            // title с URL.href: IDN-домен виден в punycode — частичная защита от гомографов.
            title={segment.href}
            target="_blank"
            // Нет window.opener (tabnabbing) и Referer с id комнаты.
            rel="noopener noreferrer nofollow"
          >
            {segment.value}
          </a>
        ),
      )}
    </>
  );
});
