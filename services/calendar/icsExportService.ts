import { CalendarEvent } from '@/types';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toICSDateUTC(date: Date): string {
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

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildVEvent(event: CalendarEvent): string {
  const now = new Date();
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@uniportal`,
    `DTSTAMP:${toICSDateUTC(now)}`,
    `DTSTART:${toICSDateUTC(event.startDateTime)}`,
    `DTEND:${toICSDateUTC(event.endDateTime)}`,
    `SUMMARY:${escapeICSText(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeICSText(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }

  if (event.reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeICSText(event.title)}`,
      `TRIGGER:-PT${event.reminderMinutes}M`,
      'END:VALARM'
    );
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export function generateICS(events: CalendarEvent[], calendarName: string = 'UniPortal'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UniPortal//Calendar Export//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    ...events.map(buildVEvent),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export function downloadICS(icsContent: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
