import type { PlanBuilder } from "../sample.js";
import type { EffectKind } from "../spec.js";
import { appearPlan, disappearPlan } from "./appear.js";
import { bouncePlan } from "./bounce.js";
import { breathePlan } from "./breathe.js";
import { drawPlan } from "./draw.js";
import { pulsePlan } from "./pulse.js";
import { replacePlan } from "./replace.js";
import { rotatePlan } from "./rotate.js";
import { scalePlan } from "./scale.js";
import { variableColorPlan } from "./variable-color.js";
import { wigglePlan } from "./wiggle.js";

/** The built-in plans, by kind. A static table, so importing the engine has no side effects. */
export const BUILTIN_PLANS: Partial<Record<EffectKind, PlanBuilder>> = {
  appear: appearPlan,
  bounce: bouncePlan,
  breathe: breathePlan,
  disappear: disappearPlan,
  draw: drawPlan,
  magicReplace: replacePlan,
  pulse: pulsePlan,
  replace: replacePlan,
  rotate: rotatePlan,
  scale: scalePlan,
  variableColor: variableColorPlan,
  wiggle: wigglePlan,
};
