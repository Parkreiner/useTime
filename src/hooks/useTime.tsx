/**
 * @file Defines a centralized, dependency-injection-friendly, 99% render-safe
 * way of defining time values in a React application.
 *
 * @todo Add support for a `paused` property to the hook that shuts down
 * re-renders.
 */
import {
  type FC,
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import dayjs, { Dayjs } from "dayjs";

type IntervalMs = number;
type SubscriptionCallback = (newTime: Dayjs) => void;
type SetTimeout = typeof window.setTimeout;
type ClearTimeout = typeof window.clearTimeout;

type TimeManagerInit = Readonly<{
  initialTime: Dayjs;
  setTimeout?: SetTimeout;
  clearTimeout?: ClearTimeout;
}>;

export class TimeManager {
  readonly #subscriptions: Map<IntervalMs, Set<SubscriptionCallback>>;
  readonly #setTimeout: SetTimeout;
  readonly #clearTimeout: ClearTimeout;

  #latestTime: Dayjs;
  #nextTickId: number | undefined;
  #nextTickMs: number | undefined;

  constructor({
    initialTime,
    setTimeout = window.setTimeout,
    clearTimeout = window.clearTimeout,
  }: TimeManagerInit) {
    this.#latestTime = initialTime;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
    this.#nextTickId = undefined;
    this.#nextTickMs = undefined;
    this.#subscriptions = new Map();
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
     * class definition doesn't have a way to track
     */
    this.#nextTickMs = Infinity;

    this.#nextTickId = this.#setTimeout(this.tick, this.#nextTickMs);
  }

  getMostRecentTimeUpdate = (): Dayjs => {
    return this.#latestTime;
  };

  subscribe = (
    cb: SubscriptionCallback,
    updateIntervalMs: number
  ): (() => void) => {
    const subGroup = this.#subscriptions.get(updateIntervalMs) ?? new Set();
    if (!this.#subscriptions.has(updateIntervalMs)) {
      this.#subscriptions.set(updateIntervalMs, subGroup);
      this.scheduleNextTick();
    }

    subGroup.add(cb);

    return () => {
      subGroup?.delete(cb);

      if (subGroup?.size === 0) {
        this.#subscriptions.delete(updateIntervalMs);
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

const TimeManagerContext = createContext<TimeManager | null>(null);

type TransformCallback<TTransform = unknown> = (
  time: Dayjs
) => Awaited<TTransform>;

type UseTimeConfig<TTransform = unknown> = Readonly<{
  maxUpdateIntervalMs?: number;
  transform?: TransformCallback<TTransform>;
}>;

type UseTimeReturnValue<TTransform = unknown> = [TTransform] extends [never]
  ? Dayjs
  : ReturnType<TransformCallback<TTransform>>;

export function useTime<TTransform = never>(
  config?: UseTimeConfig<TTransform>
): UseTimeReturnValue<TTransform> {
  const manager = useContext(TimeManagerContext);
  if (manager === null) {
    throw new Error(
      `${useTime.name}: hook called in component that is not wrapped inside TimeProvider`
    );
  }

  const { transform, maxUpdateIntervalMs = Infinity } = config ?? {};

  const subscribe = useCallback(
    (notifyReact: () => void) => {
      return manager.subscribe(notifyReact, maxUpdateIntervalMs);
    },
    [manager, maxUpdateIntervalMs]
  );

  const time = useSyncExternalStore(subscribe, manager.getMostRecentTimeUpdate);
  type Return = ReturnType<typeof useTime<TTransform>>;

  if (transform) {
    return transform(time) as Return;
  }

  return time as Return;
}

type Props = Readonly<
  PropsWithChildren<{
    initialTime?: Dayjs;
    timeManager?: typeof TimeManager;
  }>
>;

export const TimeProvider: FC<Props> = ({
  // Defining the fallback initialTime like this does break React rules by
  // introducing non-deterministic input, but this only affects the initial
  // render. All re-renders stay 100% pure.
  initialTime = dayjs(),
  timeManager = TimeManager,
  children,
}) => {
  // None of the manager methods are safe to call while inside render logic. All
  // of them must be called from effects and event handlers
  const [readonlyStableManager] = useState(
    () => new timeManager({ initialTime })
  );

  // Have to add manager to dependency array to satisfy ESLint rules, but the
  // memory reference will be stable as long as this component stays mounted
  useEffect(() => {
    return readonlyStableManager.cleanup();
  }, [readonlyStableManager]);

  return (
    <TimeManagerContext.Provider value={readonlyStableManager}>
      {children}
    </TimeManagerContext.Provider>
  );
};
