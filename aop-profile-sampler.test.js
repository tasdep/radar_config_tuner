const test = require("node:test");
const assert = require("node:assert/strict");
const { aopSampleProfiles } = require("./aop-profile-sampler.js");
const { aopPossibilities } = require("./aop-possibilities.js");

const requirements = { frameRateHz: 10, requiredRangeM: 20,
  velocityResolutionLimitMs: 0.051 };

test("sampled search keeps all target-directed anchors and is reproducible", () => {
  const anchors = aopPossibilities(requirements);
  const onlyAnchors = aopSampleProfiles({ ...requirements, sampleCount: 0, seed: 42 });
  assert.equal(onlyAnchors.stats.anchorProfiles, anchors.candidates.length);
  assert.equal(onlyAnchors.candidates.length, anchors.candidates.length);
  const first = aopSampleProfiles({ ...requirements, sampleCount: 2000, seed: 42 });
  const second = aopSampleProfiles({ ...requirements, sampleCount: 2000, seed: 42 });
  assert.deepEqual(first, second);
  assert.ok(first.candidates.length > anchors.candidates.length);
  assert.ok(first.frontier.length >= anchors.frontier.length);
});

test("sampled profiles obey quantized SDK, RF, frame, and L3 checks", () => {
  const result = aopSampleProfiles({ ...requirements, sampleCount: 4000, seed: 20261030 });
  assert.ok(result.stats.acceptedSamples > 1000);
  assert.ok(result.candidates.some((row) => row.startGHz > 61));
  assert.ok(result.candidates.some((row) => row.source === "sampled" &&
    row.sampleRateKsps !== 2000 && row.sampleRateKsps !== 2500 &&
    row.sampleRateKsps !== 3000));
  for (const fftBins of [64, 128, 256, 512]) {
    const starts = result.candidates.filter((row) => row.source === "sampled" &&
      row.fftBins === fftBins).map((row) => row.startGHz);
    assert.ok(starts.some((start) => start < 60.5));
    assert.ok(starts.some((start) => start > 61));
  }
  for (const row of result.candidates) {
    assert.ok([64, 128, 256, 512].includes(row.fftBins));
    assert.ok(row.loops >= 2 && row.loops <= 255 && row.loops % 2 === 0);
    assert.ok(row.l3FreeBytes >= 0);
    assert.ok(row.activeMs <= 50 + 1e-9);
    assert.ok(row.usableRangeM >= 20.1 - 1e-9);
    assert.ok(row.velocityResolutionMs <= 0.051 + 1e-12);
  }
  for (let i = 1; i < result.frontier.length; i++) {
    assert.ok(result.frontier[i].rangeResolutionM >= result.frontier[i - 1].rangeResolutionM);
    assert.ok(result.frontier[i].maxVelocityMs > result.frontier[i - 1].maxVelocityMs);
  }
});

test("higher frame rate with tight Doppler target remains infeasible at 50% duty", () => {
  const result = aopSampleProfiles({ frameRateHz: 20, requiredRangeM: 20,
    velocityResolutionLimitMs: 0.051, sampleCount: 4000, seed: 10 });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.stats.acceptedSamples, 0);
});
