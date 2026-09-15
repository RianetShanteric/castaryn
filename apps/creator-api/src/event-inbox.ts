export interface ChatNotificationRuntime {
  handleNotificationPayload(payload: JsonValue): Promise<void>;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type InboxEvent = {
  provider: string;
  messageId: string;
  eventType: string;
  payload: JsonValue;
  attempts: number;
};

export interface EventInboxRepository {
  enqueue(input: {
    provider: string;
    messageId: string;
    eventType: string;
    payload: JsonValue;
  }): Promise<boolean>;
  claim(now: Date, limit: number): Promise<InboxEvent[]>;
  markProcessed(
    provider: string,
    messageId: string,
    processedAt: Date,
  ): Promise<void>;
  markFailed(input: {
    provider: string;
    messageId: string;
    availableAt: Date;
    errorCode: string;
    deadLetter: boolean;
  }): Promise<void>;
  cleanup(now: Date): Promise<void>;
}

export class ExternalEventInbox {
  constructor(private readonly repository: EventInboxRepository) {}

  enqueue(
    provider: string,
    messageId: string,
    eventType: string,
    payload: JsonValue,
  ) {
    return this.repository.enqueue({
      provider,
      messageId,
      eventType,
      payload,
    });
  }
}

export class ExternalEventWorker {
  private running = false;
  private lastCleanupAt = 0;

  constructor(
    private readonly repository: EventInboxRepository,
    private readonly runtimes: Partial<Record<string, ChatNotificationRuntime>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 20) {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.now();
      if (now.getTime() - this.lastCleanupAt >= 60 * 60 * 1000) {
        await this.repository.cleanup(now);
        this.lastCleanupAt = now.getTime();
      }
      const events = await this.repository.claim(now, limit);
      for (const event of events) {
        await this.process(event);
      }
      return events.length;
    } finally {
      this.running = false;
    }
  }

  private async process(event: InboxEvent) {
    const now = this.now();
    try {
      if (event.eventType === "notification") {
        const runtime = this.runtimes[event.provider];
        if (runtime) {
          await runtime.handleNotificationPayload(event.payload);
        }
      }
      await this.repository.markProcessed(
        event.provider,
        event.messageId,
        now,
      );
    } catch (error) {
      const deadLetter = event.attempts >= 5;
      const delaySeconds = Math.min(300, 2 ** event.attempts);
      await this.repository.markFailed({
        provider: event.provider,
        messageId: event.messageId,
        availableAt: new Date(now.getTime() + delaySeconds * 1000),
        errorCode: classifyError(error),
        deadLetter,
      });
    }
  }
}

function classifyError(error: unknown) {
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 80);
  }
  return "UnknownError";
}
