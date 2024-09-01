import { describe, expect, it } from "vitest";
import { useTimeSync, TimeSyncProvider } from "./useTimeSync";
import { TimeSync } from "./TimeSync";

describe(TimeSyncProvider.name, () => {
  it("Should expose the same TimeManager reference across re-renders", () => {
    expect.hasAssertions();
  });

  it(`Should call ${TimeSync.name}'s \`cleanup\` method on unmount only`, () => {
    expect.hasAssertions();
  });
});

describe(useTimeSync.name, () => {
  it("Should return the raw time value if no transform callback is provided", () => {
    expect.hasAssertions();
  });

  it("Should return the result of a transform callback if callback is provided", () => {
    expect.hasAssertions();
  });

  it("Should let a component pause state updates, so that even if time state changes, the component will not re-render", () => {
    expect.hasAssertions();
  });
});
