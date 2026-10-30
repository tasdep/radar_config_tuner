#!/usr/bin/env node
// Offline SDK 3.x TDM config checker, with pinned xWR68xx_AOP SDK 3.6 L3 limits.
const fs = require("node:fs");
const { analyzeConfig } = require("./config-analysis.js");

const args = process.argv.slice(2);
const json = args.includes("--json");
const targetIndex = args.indexOf("--max-doppler-resolution");
const maxDopplerResolution = targetIndex < 0 ? null : Number(args[targetIndex + 1]);
const files = args.filter((arg, index) => arg !== "--json" &&
  arg !== "--max-doppler-resolution" && (targetIndex < 0 || index !== targetIndex + 1));
if (files.length !== 1) {
  console.error("Usage: node check-config.js [--json] [--max-doppler-resolution m/s] path/to/config.cfg");
  process.exit(2);
}
if (targetIndex >= 0 && (!Number.isFinite(maxDopplerResolution) || maxDopplerResolution <= 0)) {
  console.error("--max-doppler-resolution needs a positive m/s value.");
  process.exit(2);
}

try {
  const result = analyzeConfig(fs.readFileSync(files[0], "utf8"));
  if (maxDopplerResolution !== null && result.velocityResolutionMs > maxDopplerResolution) {
    result.errors.push(`Nominal Doppler resolution ${result.velocityResolutionMs.toFixed(6)} m/s exceeds requested ${maxDopplerResolution.toFixed(6)} m/s.`);
  }
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Frame: ${result.loops} loops, ${result.chirpsPerFrame} chirps, ${result.frameRateHz.toFixed(2)} Hz`);
    console.log(`Range: ${result.rangeResolutionM.toFixed(4)} m nominal resolution, ${result.rangeBinM.toFixed(4)} m/bin, ${result.usableRangeM.toFixed(2)} m TI 80% estimate`);
    console.log(`Velocity: ${result.velocityResolutionMs.toFixed(6)} m/s nominal resolution, ${result.dopplerStepMs.toFixed(6)} m/s FFT bin step, ±${result.maxVelocityMs.toFixed(3)} m/s`);
    if (result.hpf2CornerRangeM !== null) {
      console.log(`HPF2: ${result.hpf2CornerRangeM.toFixed(2)} m beat-frequency equivalent (analog attenuation, not a hard cutoff)`);
    }
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
