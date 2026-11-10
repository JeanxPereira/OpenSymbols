import { registerEffects } from "@opensymbols/react";
import { useSymbolEffects } from "./use-effect.js";

// The side effect this entry exists for (`sideEffects` lists it): icons mounted from now on read
// their `effect`, `trigger`, `active`, `visible` and `effectRef` props.
registerEffects({ useSymbolEffects });

export { Replace } from "./replace.js";
export type { ReplaceProps } from "./replace.js";
// @internal: the driver's drawing, spec and write path, for the demo's timeline scrubber. The public
// API of this entry is the registration (the import itself) and `Replace`.
export { renderFrame } from "./driver.js";
export { drawingOf, toSpec } from "./use-effect.js";
export type { DrawingKey } from "./use-effect.js";
export type { EffectProps, SymbolHandle } from "@opensymbols/react";
