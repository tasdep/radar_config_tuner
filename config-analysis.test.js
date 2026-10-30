const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeConfig } = require("./config-analysis.js");
const { aopL3Usage } = require("./sdk36-aop-limits.js");

const config = `% Platform:xWR68xx_AOP
channelCfg 15 7 0
adcCfg 2 1
adcbufCfg -1 0 1 1 1
profileCfg 0 60 179 7 23 0 0 54 1 128 9142 0 0 158
chirpCfg 0 0 0 0 0 0 0 1
chirpCfg 1 1 0 0 0 0 0 2
chirpCfg 2 2 0 0 0 0 0 4
frameCfg 0 2 80 0 100 1 0
cfarCfg -1 0 2 8 4 3 0 15 1
cfarFovCfg -1 0 0 20
cfarFovCfg -1 1 -2 2
`;

test("analyzes generated SDK 3.x TDM config", () => {
  const result = analyzeConfig(config);
  assert.equal(result.txCount, 3);
  assert.equal(result.chirpsPerFrame, 240);
  assert.equal(result.frameRateHz, 10);
  assert.equal(result.thresholds[0], 15);
  assert.deepEqual(result.fov[0], [0, 20]);
  assert.ok(Math.abs(result.activeMs - 48.48) < 0.001);
  assert.ok(result.rangeResolutionM > 0.15 && result.rangeResolutionM < 0.25);
  assert.ok(result.maxVelocityMs > 1.9 && result.maxVelocityMs < 2.1);
  assert.equal(result.l3.usedBytes, 512 * 1024);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("rejects original 256-loop frame and SDK 3.6 AOP L3 overrun", () => {
  const result = analyzeConfig(config
    .replace("179 7 23", "40 7 23")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 256"));
  assert.equal(result.l3.radarCubeBytes, 1536 * 1024);
  assert.equal(result.l3.detectionMatrixBytes, 64 * 1024);
  assert.match(result.errors.join(" "), /1–255/);
  assert.match(result.errors.join(" "), /1600.0 KiB/);
});

test("matches the SDK L3 boundary at 122 and 123 loops", () => {
  const at122 = analyzeConfig(config.replace("frameCfg 0 2 80", "frameCfg 0 2 122"));
  const at123 = analyzeConfig(config.replace("frameCfg 0 2 80", "frameCfg 0 2 123"));
  assert.equal(at122.l3.usedBytes, 764 * 1024);
  assert.equal(at122.l3.freeBytes, 4 * 1024);
  assert.deepEqual(at122.errors, []);
  assert.equal(at123.l3.usedBytes, 770 * 1024);
  assert.match(at123.errors.join(" "), /L3/);
});

test("distinguishes TI usable range from full FFT span", () => {
  const result = analyzeConfig(config.replace("cfarFovCfg -1 0 0 20", "cfarFovCfg -1 0 0 21"));
  assert.ok(result.rangeSpanM > 21);
  assert.ok(result.usableRangeM < 21);
  assert.match(result.warnings.join(" "), /80% IF usable-range/);
});

test("uses uploaded ADC start, TX count, and frame period", () => {
  const result = analyzeConfig(config
    .replace("179 7 23", "179 9 23")
    .replace("chirpCfg 2 2 0 0 0 0 0 4\n", "")
    .replace("frameCfg 0 2 80 0 100", "frameCfg 0 1 80 0 80"));
  assert.equal(result.txCount, 2);
  assert.equal(result.frameRateHz, 12.5);
  assert.ok(result.maxVelocityMs > analyzeConfig(config).maxVelocityMs);
  assert.ok(result.centerGHz > analyzeConfig(config).centerGHz);
});

test("reports unsupported chirp patterns and missing commands", () => {
  assert.throws(() => analyzeConfig(config.replace("0 0 0 4", "0 0 0 3")), /one TX antenna/);
  assert.throws(() => analyzeConfig(config.replace("frameCfg 0 2 80 0 100 1 0", "")), /frameCfg/);
  assert.throws(() => analyzeConfig(config.replace("chirpCfg 2 2 0 0 0 0 0 4", "chirpCfg 2 2 0 1 0 0 0 4")), /profile variations/);
});

test("warns when ADC capture and frame timing do not fit", () => {
  const result = analyzeConfig(config
    .replace("179 7 23", "179 15 20")
    .replace("frameCfg 0 2 80 0 100", "frameCfg 0 2 80 0 30"));
  assert.match(result.warnings.join(" "), /ADC capture/);
  assert.match(result.warnings.join(" "), /Active chirps/);
});

test("rejects odd HWA Doppler loops and labels no-packet observation separately", () => {
  const odd = analyzeConfig(config
    .replace("1 128 9142", "1 256 9142")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 59"));
  assert.match(odd.errors.join(" "), /even number of Doppler loops/);
  const noPackets = analyzeConfig(config
    .replace("1 128 9142", "1 512 9142")
    .replace("179 7 23", "179 7 66")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 30"));
  assert.deepEqual(noPackets.errors, []);
  assert.match(noPackets.warnings.join(" "), /no valid packets/);
});

test("uses SDK constant and quantized slope at the hard Doppler target", () => {
  const result = analyzeConfig(config
    .replace("179 7 23 0 0 54", "121 7 23 0 0 54.5")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 112"));
  assert.ok(result.velocityResolutionMs > 0.051);
  assert.ok(result.velocityResolutionMs < 0.05103);
  assert.equal(result.quantizedProfile.slopeRegister, 1505);
  assert.ok(result.dopplerStepMs < result.velocityResolutionMs);
});

test("models but rejects the unsupported 1024 FFT / 1022 processed-bin AOP workaround", () => {
  const result = analyzeConfig(config
    .replace("179 7 23 0 0 54 1 128 9142", "951 7 181 0 0 21.55 1 688 4000")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 14")
    .replace("cfarFovCfg -1 0 0 20", "cfarFovCfg -1 0 0 22"));
  assert.equal(result.fftRangeBins, 1024);
  assert.equal(result.rangeBins, 1022);
  assert.equal(result.l3.usedBytes, 719488);
  assert.ok(result.velocityResolutionMs <= 0.051);
  assert.match(result.errors.join(" "), /1024-bin.*unsupported/);
});

test("accounts for the demo's minimum eight Doppler FFT bins", () => {
  assert.equal(aopL3Usage({ adcSamples: 128, loops: 2, txCount: 3 }).dopplerBins, 8);
});

test("rejects unsupported ADC mode, sample rate, and odd HWA loops", () => {
  const result = analyzeConfig(config
    .replace("adcCfg 2 1", "adcCfg 2 0")
    .replace("1 128 9142", "1 128 13000")
    .replace("frameCfg 0 2 80", "frameCfg 0 2 79"));
  assert.match(result.errors.join(" "), /16-bit complex/);
  assert.match(result.errors.join(" "), /sample rate/);
  assert.match(result.errors.join(" "), /even number/);
});
