/**
 * @file Defines a centralized, dependency-injection-friendly, 99% render-safe
 * way of defining time values in a React application.
 */
import {
  type FC,
  type PropsWithChildren,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import dayjs, { Dayjs } from "dayjs";

const SSR_INTIAL_RENDER_DATA_ATTRIBUTE = "data-useTimeSync-ssr-initial-value";
const SSR_HOOK_ID_DATA_ATTRIBUTE = "data-hook-id";

// Have explicit type annotation to prevent TypeScript from inferring an opaque
// value as being something more specific (and making the value not be opaque)
const SSR_INITIAL_RENDER_OPAQUE_VALUE: string =
  "<--USE_TIME_SYNC-SSR_INITIAL_RENDER-->";

type IntervalMs = number;
type SubscriptionCallback = (newTime: Dayjs) => void;
type SetTimeout = typeof window.setTimeout;
type ClearTimeout = typeof window.clearTimeout;

type TimeSyncInit = Readonly<{
  initialTime: Dayjs;
  setTimeout?: SetTimeout;
  clearTimeout?: ClearTimeout;
}>;

type SubscriptionRequest = Readonly<{
  requestId: string;
  callback: SubscriptionCallback;
  maxUpdateIntervalMs: number;
}>;

export class TimeSync {
  readonly #subscriptions = new Map<IntervalMs, Set<SubscriptionCallback>>();
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
  // to setTimeout
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

  getValue = (requestId: string, isPaused: boolean): Dayjs => {
    return this.#latestTime;
  };

  subscribe = ({
    callback,
    maxUpdateIntervalMs,
    requestId,
  }: SubscriptionRequest): (() => void) => {
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
  };

  cleanup = (): void => {
    if (this.#nextTickId !== undefined) {
      window.clearTimeout(this.#nextTickId);
      this.#nextTickId = undefined;
    }
  };
}

const TimeSyncContext = createContext<TimeSync | null>(null);

type UseTimeConfig = Readonly<{
  formatter?: (time: Dayjs) => string;
  maxUpdateIntervalMs?: number;
  paused?: boolean;
}>;

/*
  eslint-disable-next-line react-refresh/only-export-components --
  Splitting up the hook and context means that we'd have to export out the
  context, which means less data hiding. Will worry about React Refresh once
  this code is actually working.
*/
export function useTimeSync(config?: UseTimeConfig): ReactNode {
  const sync = useContext(TimeSyncContext);
  if (sync === null) {
    throw new Error(
      `${useTimeSync.name}: hook called in component that is not wrapped inside TimeProvider`
    );
  }

  const {
    formatter,
    paused = false,
    maxUpdateIntervalMs = Infinity,
  } = config ?? {};

  const hookId = useId();

  const subscribe = useCallback(
    (notifyReact: () => void) => {
      return sync.subscribe({
        requestId: hookId,
        callback: notifyReact,
        maxUpdateIntervalMs,
      });
    },
    [sync, hookId, maxUpdateIntervalMs]
  );

  const getClientValue = useCallback(() => {
    return sync.getValue(hookId, paused);
  }, [sync, hookId, paused]);

  // String values will only ever be used for server rendering and hydration
  const time = useSyncExternalStore<Dayjs | string>(
    subscribe,
    getClientValue,
    () => SSR_INITIAL_RENDER_OPAQUE_VALUE
  );

  if (typeof time === "string") {
    return (
      <span
        {...{
          [SSR_INTIAL_RENDER_DATA_ATTRIBUTE]: true,
          children: SSR_INITIAL_RENDER_OPAQUE_VALUE,
          [SSR_HOOK_ID_DATA_ATTRIBUTE]: hookId,
        }}
      />
    );
  }

  return formatter ? formatter(time) : time.toString();
}

// Handles taking each placeholder value generated from an initial server render
// and swapping them out for a real time value before anything gets painted to
// the screen. Have to define this as a component because the hook logic needs
// to be called conditionally based on the value of the TimeProvider's SSR prop
const SsrPlaceholderSwapper: FC = () => {
  const contextValue = useContext(TimeSyncContext);
  if (contextValue === null) {
    throw new Error("TimeProvider does not have a TimeSync defined");
  }

  // Capturing the context value after narrowing it in the render logic so that
  // it can safely be referenced inside the useLayoutEffect callback without any
  // need for further type narrowing logic
  const timeSync = contextValue;
  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const placeholderElements = document.querySelector(
      `[${SSR_INTIAL_RENDER_DATA_ATTRIBUTE}="true"]`
    );
  }, [timeSync]);

  return null;
};

function defaultCreateTimeSync(initialTime: Dayjs): TimeSync {
  return new TimeSync({ initialTime });
}

type TimeSyncProviderProps = Readonly<
  PropsWithChildren<{
    initialTime?: Dayjs;
    createTimeSync?: typeof defaultCreateTimeSync;
    ssr?: boolean;
  }>
>;

export const TimeSyncProvider: FC<TimeSyncProviderProps> = ({
  // Defining the fallback initialTime like this does break React rules by
  // introducing non-deterministic input, but this only affects the initial
  // render. All re-renders stay 100% pure.
  initialTime = dayjs(),
  createTimeSync = defaultCreateTimeSync,
  ssr = false,
  children,
}) => {
  const [readonlySync] = useState(() => createTimeSync(initialTime));
  useEffect(() => {
    return () => readonlySync.cleanup();
  }, [readonlySync]);

  return (
    <TimeSyncContext.Provider value={readonlySync}>
      {ssr && <SsrPlaceholderSwapper />}
      {children}
    </TimeSyncContext.Provider>
  );
};
