import { CalendarEvent } from '@/types';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toGoogleDateUTC(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const dates = `${toGoogleDateUTC(event.startDateTime)}/${toGoogleDateUTC(event.endDateTime)}`;
  const details = [event.description, event.url].filter(Boolean).join('\n\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    details,
    location: event.location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
