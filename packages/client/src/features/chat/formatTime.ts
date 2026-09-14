// Один форматтер на модуль: создание Intl.DateTimeFormat заметно дороже вызова format().
// Часовой пояс — локальный для клиента (PRD: время по локальным часам клиента).
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Время сообщения `HH:MM` по локальному часовому поясу; ts — epoch ms серверных часов. */
export function formatTime(ts: number): string {
  return timeFormatter.format(ts);
}
