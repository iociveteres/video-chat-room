export type TextSegment =
  | { kind: 'text'; value: string }
  /** value — как в исходном тексте, href — нормализованный URL.href. */
  | { kind: 'link'; value: string; href: string };

/** Кандидаты в ссылки: только явная схема http(s); `www.example.com` не распознаётся. */
const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>"'`]+/giu;
/** Пунктуация, которой обычно заканчивается предложение, а не ссылка. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '»', '"', "'"]);
const OPENING_BRACKET: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function count(text: string, char: string): number {
  let result = 0;
  for (const c of text) if (c === char) result += 1;
  return result;
}

/**
 * Отрезает хвостовую пунктуацию и закрывающие скобки без пары внутри кандидата:
 * `https://a.b/c).` → `https://a.b/c`, но `https://a.b/Mesh_(x)` остаётся целым.
 */
function trimCandidate(candidate: string): string {
  let result = candidate;
  for (let last = result.at(-1); last !== undefined; last = result.at(-1)) {
    const opening = OPENING_BRACKET[last];
    if (TRAILING_PUNCTUATION.has(last)) {
      result = result.slice(0, -1);
    } else if (opening !== undefined && count(result, last) > count(result, opening)) {
      result = result.slice(0, -1);
    } else {
      break;
    }
  }
  return result;
}

/** URL.href, если кандидат — корректный http(s)-адрес; иначе null. */
function toSafeHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    // Перепроверка после разбора: другие схемы (javascript:, data:, …) никогда не становятся ссылкой.
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Разбивает текст сообщения на текст и http(s)-ссылки (TDD v2 §4.3.3). Чистая функция без DOM:
 * рендер сегментов — в MessageText. При сомнении фрагмент остаётся текстом.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Конец последней ссылки: всё между ссылками, включая отвергнутых кандидатов, — текст.
  let position = 0;

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = trimCandidate(match[0]);
    const href = toSafeHref(candidate);
    if (href === null) continue;

    if (match.index > position) {
      segments.push({ kind: 'text', value: text.slice(position, match.index) });
    }
    segments.push({ kind: 'link', value: candidate, href });
    position = match.index + candidate.length;
  }

  if (position < text.length) segments.push({ kind: 'text', value: text.slice(position) });
  return segments;
}
