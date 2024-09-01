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
import { TimeSync } from "./TimeSync";

const SSR_PLACEHOLDER_ID_PREFIX = "data-useTimeSync-ssr";

// Have explicit type annotation to prevent TypeScript from inferring an opaque
// value as being something more specific (and making the value not be opaque)
const SSR_INITIAL_RENDER_OPAQUE_VALUE: string =
  "<--USE_TIME_SYNC-SSR_INITIAL_RENDER-->";

type TimeFormatter = (time: Dayjs) => string;
type ComponentFormatterTracker = MutableRefObject<{
  processable: boolean;
  components: Map<string, TimeFormatter | undefined>;
}>;

const TimeSyncContext = createContext<TimeSync | null>(null);
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
      <span id={`${SSR_PLACEHOLDER_ID_PREFIX}-${hookId}`}>
        {SSR_INITIAL_RENDER_OPAQUE_VALUE}
      </span>
    );
  }

  return formatter ? formatter(time) : time.toString();
}

type SsrPlaceholderSwapperProps = Readonly<
  PropsWithChildren<{
    timeSync: TimeSync;
    tracker: ComponentFormatterTracker;
  }>
>;

// Handles taking each placeholder value generated from an initial server render
// and swapping them out for a real time value before anything gets painted to
// the screen. Have to define this as a component because the hook logic needs
// to be called conditionally based on the value of the TimeProvider's SSR prop
const SsrPlaceholderSwapper: FC<SsrPlaceholderSwapperProps> = ({
  timeSync,
  tracker,
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

    const ref = tracker.current;
    ref.processable = false;
    const cleanup = () => {
      ref.processable = true;
    };

    const placeholderElements = document.querySelectorAll<HTMLSpanElement>(
      `[id^="${SSR_PLACEHOLDER_ID_PREFIX}"]`
    );

    if (placeholderElements.length === 0) {
      return cleanup;
    }

    const initialTime = timeSync.getValue();
    const initialString = initialTime.toString();

    for (const el of placeholderElements) {
      const hookId = el.getAttribute(SSR_PLACEHOLDER_ID_PREFIX);
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
    return cleanup;
  }, [timeSync, tracker]);

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
  const [timeSync] = useState(() => createTimeSync(initialTime));
  useEffect(() => {
    return () => timeSync.cleanup();
  }, [timeSync]);

  const tracker: ComponentFormatterTracker = useRef(null!);
  if (tracker.current === null) {
    tracker.current = {
      processable: true,
      components: new Map(),
    };
  }

  return (
    <TimeSyncContext.Provider value={timeSync}>
      <FormatterTrackerContext.Provider value={tracker}>
        {ssr ? (
          <SsrPlaceholderSwapper timeSync={timeSync} tracker={tracker}>
            {children}
          </SsrPlaceholderSwapper>
        ) : (
          <>{children}</>
        )}
      </FormatterTrackerContext.Provider>
    </TimeSyncContext.Provider>
  );
};
