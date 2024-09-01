/**
 * @file Defines a centralized, dependency-injection-friendly, 99% render-safe
 * way of defining time values in a React application.
 */
import {
  type FC,
  type MutableRefObject,
  type PropsWithChildren,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dayjs, { type Dayjs } from "dayjs";

const SSR_HOOK_ID_DATA_ATTRIBUTE = "data-useTimeSync-ssr-hook-id";
const SSR_INTIAL_RENDER_DATA_ATTRIBUTE = "data-useTimeSync-ssr-initial-value";

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

const TimeSyncContext = createContext<TimeSync | null>(null);

type TimeFormatter = (time: Dayjs) => string;

type ComponentFormatterTracker = MutableRefObject<{
  processable: boolean;
  components: Map<string, TimeFormatter | undefined>;
}>;

const FormatterTrackerContext = createContext<ComponentFormatterTracker | null>(
  null
);

type UseTimeConfig = Readonly<{
  formatter?: TimeFormatter;
  targetUpdateIntervalMs?: number;
}>;

/*
  eslint-disable-next-line react-refresh/only-export-components --
  Splitting up the hook and context means that we'd have to export out the
  context, which means less data hiding. Will worry about React Refresh once
  this code is actually working.
*/
export function useTimeSync(config?: UseTimeConfig): ReactNode {
  const sync = useContext(TimeSyncContext);
  const tracker = useContext(FormatterTrackerContext);
  if (sync === null || tracker === null) {
    throw new Error(
      `${useTimeSync.name}: hook called in component that is not wrapped inside TimeProvider`
    );
  }

  const { formatter, targetUpdateIntervalMs = Infinity } = config ?? {};

  // Abusing useId a little bit. It's meant to be used as a hydration-friendly
  // way of improving accessibility, but as a side effect of the implementation,
  // it gives us a stable, opaque value that is uniquely associated with a
  // component instance.
  const hookId = useId();
  useLayoutEffect(() => {
    if (tracker.current.processable) {
      tracker.current.components.set(hookId, formatter);
    }

    /*
      eslint-disable-next-line react-hooks/exhaustive-deps -- This effect only
      needs to run on mount because it's only intended to help with hydration.
      Could've used/made a useEffectEvent polyfill, but that's a lot of runtime
      overhead for something that's only meant to run on mount, especially in
      library code.
    */
  }, [tracker, hookId]);

  // Have to memoize the subscription callback, because useSyncExternalStore
  // will automatically unsubscribe and resubscribe each time it receives a new
  // memory reference (even if the subscription should stay exactly the same)
  const subscribe = useCallback(
    (notifyReact: () => void) => {
      return sync.subscribe({
        callback: notifyReact,
        maxUpdateIntervalMs: targetUpdateIntervalMs,
      });
    },
    [sync, targetUpdateIntervalMs]
  );

  const time = useSyncExternalStore<Dayjs | null>(
    subscribe,
    () => sync.getValue(),
    () => null
  );

  if (time === null) {
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

type SsrPlaceholderSwapperProps = Readonly<
  PropsWithChildren<{
    timeSync: TimeSync;
    registeredCallbacksRef: ComponentFormatterTracker;
  }>
>;

// Handles taking each placeholder value generated from an initial server render
// and swapping them out for a real time value before anything gets painted to
// the screen. Have to define this as a component because the hook logic needs
// to be called conditionally based on the value of the TimeProvider's SSR prop
const SsrPlaceholderSwapper: FC<SsrPlaceholderSwapperProps> = ({
  timeSync,
  registeredCallbacksRef,
  children,
}) => {
  // React runs all queued effects from the bottom up, so because this component
  // will always be the parent to all SSR component using the useTime hook, the
  // layout effects from those hook calls are guaranteed to run first. That
  // means that our tracker will always be fully populated by the time this
  // effect runs.
  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const ref = registeredCallbacksRef.current;
    ref.processable = false;

    const placeholderElements = document.querySelectorAll<HTMLSpanElement>(
      `[${SSR_INTIAL_RENDER_DATA_ATTRIBUTE}="true"]`
    );

    const initialTime = timeSync.getValue();
    const initialString = initialTime.toString();

    for (const el of placeholderElements) {
      const hookId = el.getAttribute(SSR_HOOK_ID_DATA_ATTRIBUTE);
      if (hookId === null) {
        throw new Error("Found SSR placeholder without hook ID");
      }

      const callback = ref.components.get(hookId);
      el.innerText = callback ? callback(initialTime) : initialString;
    }

    /**
     * @todo Figure out if the cleanup function here also needs to reset the
     * text for each of the elements that were initially updated with time
     * values, or if React will automatically wipe all the changes away when it
     * re-renders. If changing the text makes React break, we also need to
     * figure out how to make sure that the cleanup function is guaranteed to
     * run after the initial render only
     */
    return () => {
      ref.processable = true;
    };
  }, [timeSync, registeredCallbacksRef]);

  return children;
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

  const tracker: ComponentFormatterTracker = useRef(null!);
  if (tracker.current === null) {
    tracker.current = {
      processable: true,
      components: new Map(),
    };
  }

  return (
    <TimeSyncContext.Provider value={readonlySync}>
      <FormatterTrackerContext.Provider value={tracker}>
        {ssr ? (
          <SsrPlaceholderSwapper
            timeSync={readonlySync}
            registeredCallbacksRef={tracker}
          >
            {children}
          </SsrPlaceholderSwapper>
        ) : (
          <>{children}</>
        )}
      </FormatterTrackerContext.Provider>
    </TimeSyncContext.Provider>
  );
};
