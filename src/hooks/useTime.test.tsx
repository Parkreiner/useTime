import { describe, expect, it, test } from "vitest";
import { useTime, TimeManager, TimeProvider } from "./useTime";

describe(TimeManager.name, () => {
  it("Defines all public functions as arrow functions to ensure that they can't lose their 'this' context", () => {
    expect.hasAssertions();
  });

  describe("`subscribe` method", () => {
    it("Should let an external system subscribe to the manager", () => {
      expect.hasAssertions();
    });

    it("Should let an external system UN-subscribe from the manager", () => {
      expect.hasAssertions();
    });

    it("Should let multiple external systems subscribe to the manager", () => {
      expect.hasAssertions();
    });

    test("If multiple systems are set up to update at different maxUpdateIntervalMs values, BOTH will update when the smallest time elapses", () => {
      expect.hasAssertions();
    });
  });

  describe("`cleanup` method", () => {
    it("Cleans up pending timeouts", () => {
      expect.hasAssertions();
    });
  });

  describe("`getMostRecentTimeUpdate` method", () => {
    it("Should return the most recent time", () => {
      expect.hasAssertions();
    });

    it("Should return the exact same value by reference if multiple calls are made but no state updates have happened since", () => {
      expect.hasAssertions();
    });
  });
});

describe(TimeProvider.name, () => {
  it("Should expose the same TimeManager reference across re-renders", () => {
    expect.hasAssertions();
  });

  it(`Should call ${TimeManager.name}'s \`cleanup\` method on unmount only`, () => {
    expect.hasAssertions();
  });
});

describe(useTime.name, () => {
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
