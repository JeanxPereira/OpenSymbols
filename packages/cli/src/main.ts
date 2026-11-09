#!/usr/bin/env node
import { runAsync } from "./run.js";

process.exitCode = await runAsync(process.argv.slice(2), process.env, {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
