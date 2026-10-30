#!/usr/bin/env node
// Offline SDK 3.x TDM config checker, with pinned xWR68xx_AOP SDK 3.6 L3 limits.
const fs = require("node:fs");
const { analyzeConfig } = require("./config-analysis.js");

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((arg) => arg !== "--json");
if (files.length !== 1) {
  console.error("Usage: node check-config.js [--json] path/to/config.cfg");
  process.exit(2);
}

try {
  const result = analyzeConfig(fs.readFileSync(files[0], "utf8"));
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Frame: ${result.loops} loops, ${result.chirpsPerFrame} chirps, ${result.frameRateHz.toFixed(2)} Hz`);
    console.log(`Range: ${result.rangeResolutionM.toFixed(4)} m resolution, ${result.rangeSpanM.toFixed(2)} m FFT span, ${result.usableRangeM.toFixed(2)} m estimated usable`);
    console.log(`Velocity: ${result.velocityResolutionMs.toFixed(4)} m/s resolution, ±${result.maxVelocityMs.toFixed(3)} m/s`);
    if (result.l3) {
      console.log(`SDK 3.6 AOP L3: ${(result.l3.usedBytes / 1024).toFixed(1)} / 768 KiB (${(result.l3.freeBytes / 1024).toFixed(1)} KiB free)`);
    }
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
    if (!result.errors.length) console.log("No modeled limits exceeded; device startup still requires a bench test.");
  }
  process.exitCode = result.errors.length ? 1 : 0;
} catch (error) {
  console.error(`Could not check config: ${error.message}`);
  process.exitCode = 2;
}
