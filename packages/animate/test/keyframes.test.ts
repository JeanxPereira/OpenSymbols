import { describe, expect, it } from "vitest";
import { curve } from "../src/curves.js";
import { evalTrack, trackEnd, type Track } from "../src/keyframes.js";

const track = (over: Partial<Track>): Track => ({ property: "scale", start: 0, from: 1, segments: [], ...over });

describe("evalTrack (Docs/format/07 §2.1)", () => {
  it("a two-keyframe track interpolates with its curve", () => {
    const t = track({ start: 0.5, from: 1, segments: [{ duration: 2, curve: 3, to: 3 }] });
    for (const local of [0, 0.3, 1, 1.7, 2]) {
      expect(evalTrack(t, 0.5 + local)).toBeCloseTo(1 + 2 * curve(3)(local / 2), 12);
    }
  });

  it("before start → from; past the last segment → its to", () => {
    const t = track({ start: 1, from: 1, segments: [{ duration: 1, curve: 0, to: 2 }, { duration: 1, curve: 0, to: 5 }] });
    expect(evalTrack(t, -10)).toBe(1);
    expect(evalTrack(t, 0.999)).toBe(1);
    expect(evalTrack(t, 1.5)).toBe(1.5);
    expect(evalTrack(t, 2.5)).toBe(3.5);
    expect(evalTrack(t, 3)).toBe(5);
    expect(evalTrack(t, 99)).toBe(5);
    expect(trackEnd(t)).toBe(3);
  });

  it("a zero-duration segment has already jumped at its own instant (right-continuous)", () => {
    const t = track({ start: 0.25, from: 1, segments: [{ duration: 0, curve: 0, to: 0 }] });
    expect(evalTrack(t, 0.2499)).toBe(1);
    expect(evalTrack(t, 0.25)).toBe(0);
    const mid = track({ from: 0, segments: [{ duration: 1, curve: 0, to: 0.5 }, { duration: 0, curve: 0, to: 1 }] });
    expect(evalTrack(mid, 0.999)).toBeCloseTo(0.4995, 12);
    expect(evalTrack(mid, 1)).toBe(1);
  });

  it("a track with no segments holds from; a non-finite t reads from", () => {
    expect(evalTrack(track({ from: 0.4 }), 3)).toBe(0.4);
    const t = track({ from: 2, segments: [{ duration: 1, curve: 0, to: 4 }] });
    expect(evalTrack(t, NaN)).toBe(2);
    expect(evalTrack(t, Infinity)).toBe(2);
  });
});
