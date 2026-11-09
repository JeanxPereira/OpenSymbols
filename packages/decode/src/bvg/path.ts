import { DecodeError } from "../errors.js";
import { NibbleReader } from "./nibbles.js";
import { decodeRuns } from "./numbers.js";

export type PathOp =
  | "M" | "m" | "L" | "l" | "C" | "c" | "S" | "s" | "Q" | "q"
  | "T" | "t" | "H" | "h" | "V" | "v" | "Z";

export interface PathCommand {
  op: PathOp;
  args: number[];
}

const WHERE = "BVG path";

// Docs/format/03 §3.2: command letter by high nibble. Entries 0 and 8 are L/l, or M/m when
// there is no current point; 7 is Z (never relative); 15 is not a command.
const LETTERS: readonly (PathOp | null)[] = [
  "L", "C", "S", "Q", "T", "H", "V", "Z",
  "l", "c", "s", "q", "t", "h", "v", null,
];

/**
 * Docs/format/03 §3: decode a `BVG ` path blob into SVG-style commands. Running dry ends
 * the path with what has been decoded (§1.4, §3.6); a bad header or command byte throws.
 */
export function decodePath(blob: Uint8Array): PathCommand[] {
  const r = new NibbleReader(blob);

  // Docs/format/03 §3.1: u8 0x00, readValue(4) value count, readValue(4) command count
  // (capacity hints, ignored). A first byte other than 0 is an error; [INF] so is a stream
  // too short for the two counts.
  const first = r.byte();
  if (first === null) throw new DecodeError(WHERE, "empty path stream");
  if (first !== 0) throw new DecodeError(WHERE, `first byte is 0x${hex(first)}, expected 0x00`);
  if (r.value(4) === null || r.value(4) === null) {
    throw new DecodeError(WHERE, "path stream too short for its header counts");
  }

  const out: PathCommand[] = [];
  // Docs/format/03 §3.2: no current point at the start, nor right after a Z.
  let currentPoint = false;

  for (;;) {
    // Docs/format/03 §3.2: running dry on the command byte completes the path.
    const cmd = r.byte();
    if (cmd === null) return out;
    const high = cmd >> 4;
    const low = cmd & 0xf;

    let op = LETTERS[high];
    if (op === null || op === undefined) {
      // Docs/format/03 §3.2 [INF]: high nibble 15 is an error.
      throw new DecodeError(WHERE, `invalid command byte 0x${hex(cmd)}`);
    }
    if (op === "Z") {
      // Docs/format/03 §3.2: Z takes no operands and reads nothing more; clears the point.
      out.push({ op, args: [] });
      currentPoint = false;
      continue;
    }
    if (!currentPoint) {
      if (op === "L") op = "M";
      else if (op === "l") op = "m";
    }

    // Docs/format/03 §3.3: low nibble bits 0–1 set-count width (0 = immediate),
    // bit 2 drop the last (padding) value, bit 3 packed pairs.
    const width = low & 3;
    const dropLast = (low & 4) !== 0;
    const packed = (low & 8) !== 0;

    // Docs/format/03 §3.4. Running dry here (set count, flag byte, immediate nibble) ends
    // the path WITHOUT emitting this command: §3.6 only covers running dry inside runs,
    // and this is the ruling for the gap.
    let sets: number;
    let flags: number;
    let scale: number;
    if (width !== 0) {
      const s = r.value(width);
      if (s === null) return out;
      const f = r.byte();
      if (f === null) return out;
      sets = s;
      flags = f;
      scale = 0;
    } else {
      // Immediate mode: one nibble carries signs and scale; one pair, count immediate.
      const nib = r.nibble();
      if (nib === null) return out;
      flags = 0x08 | ((nib >> 2) & 3);
      scale = nib & 3;
      sets = 1;
    }

    const { values, dry } = decodeRuns(r, flags, scale, sets, packed);
    // Docs/format/03 §3.6: drop the padding value if bit 2 is set and a value was decoded;
    // emitted even with no operands, and also when the runs ran dry.
    if (dropLast && values.length > 0) values.pop();
    out.push({ op, args: values });
    // Docs/format/03 §3.2: every command other than Z establishes a current point.
    currentPoint = true;
    if (dry) return out;
  }
}

/**
 * Shortest round-trip decimal (`String(n)`), with `-0` printed as `0`. `String` switches to
 * exponent notation below 1e-6 and from 1e21 in magnitude; that is not special-cased.
 */
export function formatNumber(n: number): string {
  return n === 0 ? "0" : String(n);
}

/** SVG `d` text: each command letter followed by its args joined by single spaces. */
export function pathToSvg(cmds: PathCommand[]): string {
  return cmds.map((c) => c.op + c.args.map(formatNumber).join(" ")).join("");
}

function hex(b: number): string {
  return b.toString(16).padStart(2, "0");
}
