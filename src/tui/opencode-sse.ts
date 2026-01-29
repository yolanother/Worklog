export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private eventId: string | undefined;
  private retryValue: number | undefined;

  push(chunk: string | Buffer): SseEvent[] {
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';

    const events: SseEvent[] = [];
    for (const line of lines) {
      if (line === '') {
        const evt = this.flushEvent();
        if (evt) events.push(evt);
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      }

      const sepIndex = line.indexOf(':');
      const field = (sepIndex === -1 ? line : line.slice(0, sepIndex)).trim();
      let value = sepIndex === -1 ? '' : line.slice(sepIndex + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      switch (field) {
        case 'data':
          this.dataLines.push(value);
          break;
        case 'event':
          this.eventName = value;
          break;
        case 'id':
          this.eventId = value;
          break;
        case 'retry': {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) this.retryValue = parsed;
          break;
        }
        default:
          break;
      }
    }

    return events;
  }

  flush(): SseEvent[] {
    const evt = this.flushEvent();
    return evt ? [evt] : [];
  }

  private flushEvent(): SseEvent | null {
    if (this.dataLines.length === 0 && !this.eventName && !this.eventId && this.retryValue === undefined) {
      return null;
    }

    const event: SseEvent = {
      data: this.dataLines.join('\n'),
    };
    if (this.eventName) event.event = this.eventName;
    if (this.eventId) event.id = this.eventId;
    if (this.retryValue !== undefined) event.retry = this.retryValue;

    this.dataLines = [];
    this.eventName = undefined;
    this.eventId = undefined;
    this.retryValue = undefined;

    return event;
  }
}
