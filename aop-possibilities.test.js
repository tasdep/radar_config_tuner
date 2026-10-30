const test = require("node:test");
const assert = require("node:assert/strict");
const { aopPossibilities } = require("./aop-possibilities.js");
const { aopL3Usage } = require("./sdk36-aop-limits.js");

test("0.051 m/s, 10 Hz and 20 m yields the expected supported tradeoff", () => {
  const result = aopPossibilities({
    frameRateHz: 10, requiredRangeM: 20, velocityResolutionLimitMs: 0.051,
  });
  assert.deepEqual(result.summaries.map((row) => row.fftBins), [64, 128, 256, 512]);
  const finest = result.summaries.at(-1);
  assert.ok(finest.rangeResolutionM > 0.048 && finest.rangeResolutionM < 0.05);
  assert.ok(finest.maxVelocityMs > 0.70 && finest.maxVelocityMs < 0.73);
  assert.ok(result.candidates.every((row) => row.velocityResolutionMs <= 0.051 &&
    row.usableRangeM >= 20.1 && row.loops % 2 === 0 &&
    aopL3Usage({ adcSamples: row.adcSamples, loops: row.loops, txCount: 3 }).freeBytes >= 64 * 1024));
});

test("frame rate and velocity resolution change feasibility", () => {
  const tight = aopPossibilities({ frameRateHz: 20, requiredRangeM: 20,
    velocityResolutionLimitMs: 0.051 });
  assert.equal(tight.candidates.length, 0);
  const relaxed = aopPossibilities({ frameRateHz: 20, requiredRangeM: 20,
    velocityResolutionLimitMs: 0.3 });
  assert.ok(relaxed.candidates.length > 0);
  assert.ok(relaxed.summaries.some((row) => row.fftBins === 64));
});

test("longer required range worsens the finest modeled range resolution", () => {
  const inputs = { frameRateHz: 10, velocityResolutionLimitMs: 0.051 };
  const at20 = aopPossibilities({ ...inputs, requiredRangeM: 20 });
  const at22 = aopPossibilities({ ...inputs, requiredRangeM: 22 });
  assert.ok(at22.summaries.at(-1).rangeResolutionM > at20.summaries.at(-1).rangeResolutionM);
  assert.ok(at22.candidates.every((row) => row.usableRangeM >= 22.1));
});
