const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeConfig } = require("./config-analysis.js");

const config = `% Platform:xWR68xx_AOP
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
  assert.deepEqual(result.warnings, []);
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
