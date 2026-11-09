#!/usr/bin/env node
import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), process.env, {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
