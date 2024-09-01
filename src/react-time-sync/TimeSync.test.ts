import { describe, expect, it, test } from "vitest";
import { TimeSync } from "./TimeSync";

describe(TimeSync.name, () => {
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
