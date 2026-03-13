export const APP_TIMEZONE = 'Europe/Warsaw';

const appDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return appDateTimeFormatter.format(parsed);
}
