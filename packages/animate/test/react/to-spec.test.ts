// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { EffectProps } from "@opensymbols/react";
import { defaultSpec, type Spec } from "../../src/index.js";
import { toSpec } from "../../src/react/use-effect.js";

const ctx = { mode: "monochrome", appearance: "light" } as const;
const spec = (kind: Spec["kind"], over: Partial<Spec> = {}): Spec => ({ ...defaultSpec(kind), ...over });

describe("toSpec: Variable Color", () => {
  it("no option: the animated form with RenderBox's defaults (cumulative, non-reversing, dim)", () => {
    const s = toSpec({ kind: "variableColor" }, ctx, "once");
    expect(s).toEqual(spec("variableColor"));
    expect("variableValue" in s).toBe(false);
  });

  it("maps fill, reversing and inactive onto vcFill, vcReversing and vcInactive", () => {
    expect(toSpec({ kind: "variableColor", fill: "iterative" }, ctx, "once")).toEqual(spec("variableColor", { vcFill: "iterative" }));
    expect(toSpec({ kind: "variableColor", fill: "cumulative" }, ctx, "once")).toEqual(spec("variableColor", { vcFill: "cumulative" }));
    expect(toSpec({ kind: "variableColor", reversing: true }, ctx, "once")).toEqual(spec("variableColor", { vcReversing: true }));
    expect(toSpec({ kind: "variableColor", reversing: false }, ctx, "once")).toEqual(spec("variableColor", { vcReversing: false }));
    expect(toSpec({ kind: "variableColor", inactive: "hide" }, ctx, "once")).toEqual(spec("variableColor", { vcInactive: "hide" }));
    expect(toSpec({ kind: "variableColor", inactive: "dim" }, ctx, "once")).toEqual(spec("variableColor", { vcInactive: "dim" }));
    const all: EffectProps = { kind: "variableColor", fill: "iterative", reversing: true, inactive: "hide", speed: 2 };
    expect(toSpec(all, { mode: "hierarchical", appearance: "dark" }, "continuous")).toEqual(
      spec("variableColor", { vcFill: "iterative", vcReversing: true, vcInactive: "hide", speed: 2, repeat: "continuous", renderingMode: "hierarchical", appearance: "dark" }),
    );
  });

  it("variableValue is the switch: present, a still frame at that value; absent, the animated form", () => {
    expect(toSpec({ kind: "variableColor", variableValue: 0.4 }, ctx, "once")).toEqual(spec("variableColor", { variableValue: 0.4 }));
    expect(toSpec({ kind: "variableColor", variableValue: 0 }, ctx, "once").variableValue).toBe(0);
    expect(toSpec({ kind: "variableColor", variableValue: undefined }, ctx, "once").variableValue).toBeUndefined();
  });

  it("repeats like Pulse: the caller's repeat reaches the spec", () => {
    expect(toSpec({ kind: "variableColor" }, ctx, "continuous").repeat).toBe("continuous");
    expect(toSpec({ kind: "pulse" }, ctx, "continuous").repeat).toBe("continuous");
    expect(toSpec({ kind: "variableColor", repeat: "continuous" }, ctx, "once").repeat).toBe("once");
  });
});
