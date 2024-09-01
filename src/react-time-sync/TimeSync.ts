import dayjs, { type Dayjs } from "dayjs";

export type SubscriptionCallback = (newTime: Dayjs) => void;
type SetTimeout = typeof window.setTimeout;
type ClearTimeout = typeof window.clearTimeout;

type TimeSyncInit = Readonly<{
  initialTime: Dayjs;
  setTimeout?: SetTimeout;
  clearTimeout?: ClearTimeout;
}>;

type SubscriptionRequest = Readonly<{
  callback: SubscriptionCallback;
  maxUpdateIntervalMs: number;
}>;

export class TimeSync {
  // Each key for the subscriptions is a specific millisecond value. That way,
  // multiple subscribers that each rely on the same value can be grouped
  readonly #subscriptions = new Map<number, Set<SubscriptionCallback>>();
  readonly #setTimeout: SetTimeout;
  readonly #clearTimeout: ClearTimeout;

  #nextTickId: number | undefined = undefined;
  #nextTickMs: number | undefined = undefined;
  #latestTime: Dayjs;

  constructor({
    initialTime,
    setTimeout = window.setTimeout,
    clearTimeout = window.clearTimeout,
  }: TimeSyncInit) {
    this.#latestTime = initialTime;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
  }

  // Defined as an arrow function so that we don't have to keep binding or
  // wrapping the tick method inside another arrow function as it gets passed
  // to setTimeout repeatedly
  private tick = (): void => {
    const newTime = dayjs();
    this.#latestTime = newTime;

    for (const subGroup of this.#subscriptions.values()) {
      for (const callback of subGroup) {
        // Dispatching with a local variable instead of using the mutable
        // currentTime property to prevent times from changing incorrectly
        // between invidividual callback resolutions
        callback(newTime);
      }
    }
  };

  private scheduleNextTick(): void {
    this.#clearTimeout(this.#nextTickId);

    let earliestPossibleUpdateMs = Infinity;
    for (const interval of this.#subscriptions.keys()) {
      if (interval < earliestPossibleUpdateMs) {
        earliestPossibleUpdateMs = interval;
      }
    }

    if (earliestPossibleUpdateMs === Infinity) {
      return;
    }

    /**
     * @todo Figure out how to calculate this value especially since the current
     * class definition doesn't have a way to track WHEN the most recent timeout
     * was queued
     */
    this.#nextTickMs = Infinity;

    this.#nextTickId = this.#setTimeout(this.tick, this.#nextTickMs);
  }

  getValue(): Dayjs {
    return this.#latestTime;
  }

  subscribe(req: SubscriptionRequest): () => void {
    const { callback, maxUpdateIntervalMs } = req;
    const subGroup = this.#subscriptions.get(maxUpdateIntervalMs) ?? new Set();
    if (!this.#subscriptions.has(maxUpdateIntervalMs)) {
      this.#subscriptions.set(maxUpdateIntervalMs, subGroup);
      this.scheduleNextTick();
    }

    subGroup.add(callback);

    return () => {
      subGroup?.delete(callback);

      if (subGroup?.size === 0) {
        this.#subscriptions.delete(maxUpdateIntervalMs);
        this.scheduleNextTick();
      }
    };
  }

  cleanup = (): void => {
    if (this.#nextTickId !== undefined) {
      window.clearTimeout(this.#nextTickId);
      this.#nextTickId = undefined;
    }
  };
}
