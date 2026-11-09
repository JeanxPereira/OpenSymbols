import { describe, expect, it } from "vitest";
import { withFsRetry } from "../../src/generate/write.js";

const fsError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: busy`), { code });

/** A clock that advances only when slept on. */
const fakeClock = () => {
  let t = 0;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: (ms: number) => void (sleeps.push(ms), (t += ms)) };
};

describe("withFsRetry", () => {
  it("retries a transient EPERM/EBUSY with backoff and returns the result", () => {
    const clock = fakeClock();
    let calls = 0;
    const r = withFsRetry("rename", "/out/symbols", () => {
      calls++;
      if (calls === 1) throw fsError("EPERM");
      if (calls === 2) throw fsError("EBUSY");
      return "done";
    }, clock);
    expect(r).toBe("done");
    expect(calls).toBe(3);
    expect(clock.sleeps).toHaveLength(2);
    expect(clock.sleeps[1]!).toBeGreaterThan(clock.sleeps[0]!);
  });

  it("does not retry other errors", () => {
    const clock = fakeClock();
    let calls = 0;
    expect(() =>
      withFsRetry("rename", "/out/x", () => {
        calls++;
        throw fsError("ENOENT");
      }, clock),
    ).toThrow(/ENOENT/);
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("gives up after about 5 s, naming the path and the likely culprits", () => {
    const clock = fakeClock();
    let e: Error | undefined;
    try {
      withFsRetry("remove", "/out/chunks", () => {
        throw fsError("EACCES");
      }, clock);
    } catch (err) {
      e = err as Error;
    }
    expect(e).toBeDefined();
    expect(e!.message).toContain("/out/chunks");
    expect(e!.message).toContain("EACCES");
    expect(e!.message).toMatch(/antivirus/);
    expect(e!.message).toMatch(/indexer/);
    expect((e!.cause as NodeJS.ErrnoException).code).toBe("EACCES");
    const waited = clock.sleeps.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(4000);
    expect(waited).toBeLessThanOrEqual(6000);
  });
});
