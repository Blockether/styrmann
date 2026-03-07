export const OPENCLAW_TIMEZONE = 'Europe/Warsaw';

const openClawDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPENCLAW_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function formatOpenClawDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return openClawDateTimeFormatter.format(parsed);
}
