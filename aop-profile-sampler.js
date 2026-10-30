// Reproducible broad profile sample for the pinned SDK 3.6 xWR64xx AOP demo.
// A sampled envelope is a lower bound on feasibility, never proof of impossibility.
const samplerLimits = typeof module !== "undefined" ?
  require("./sdk36-aop-limits.js") : aopSdk36Limits;
const samplerAnchorSearch = typeof module !== "undefined" ?
  require("./aop-possibilities.js").aopPossibilities : aopPossibilities;

const SAMPLE_FFT_BINS = [64, 128, 256, 512];
const SAMPLE_RATES_KSPS = [2000, 2500, 3000, 4000, 6000, 8000, 9142, 10000, 12000, 12500];
const SAMPLE_RF_END_GHZ = 63.9;
const SAMPLE_RANGE_MARGIN_M = 0.1;
const SAMPLE_TX = 3;
const SAMPLE_RX = 4;

function sampleRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function sampleInt(random, lo, hi) {
  return lo + Math.floor(random() * (hi - lo + 1));
}

function sampleEvenLoops(random, maximum, index) {
  const maxEven = maximum - maximum % 2;
  if (maxEven < 2) return 0;
  const variants = maxEven / 2;
  switch (index % 8) {
    case 0: return maxEven;
    case 1: return Math.max(2, maxEven - 2);
    case 2: return Math.max(2, 2 * Math.floor(variants * 0.75));
    case 3: return Math.max(2, 2 * Math.floor(variants * 0.5));
    default: return 2 * sampleInt(random, 1, variants);
  }
}

function profileKey(row) {
  return [row.startRegister, row.slopeRegister, row.idleRegister,
    row.rampRegister, row.adcSamples, row.sampleRateKsps, row.loops].join(":");
}

function candidateFromModel(model, inputs, source) {
  return {
    fftBins: model.l3.fftRangeBins,
    rangeResolutionM: model.rangeResolutionM,
    maxVelocityMs: model.maxVelocityMs,
    usableRangeM: model.usableRangeM,
    velocityResolutionMs: model.dopplerResolutionMs,
    activeMs: SAMPLE_TX * inputs.loops * model.chirpSeconds * 1000,
    l3FreeBytes: model.l3.freeBytes,
    adcSamples: inputs.adcSamples,
    sampleRateKsps: inputs.sampleRateKsps,
    loops: inputs.loops,
    startGHz: inputs.startGHz,
    slopeMHzUs: inputs.slopeMHzUs,
    rampUs: inputs.rampUs,
    idleUs: inputs.idleUs,
    source,
  };
}

function aopSampleProfiles({ frameRateHz, requiredRangeM, velocityResolutionLimitMs,
  sampleCount = 12000, seed = 0x6843a0 }) {
  if (!Number.isFinite(frameRateHz) || frameRateHz <= 0 ||
      !Number.isFinite(requiredRangeM) || requiredRangeM <= 0 ||
      !Number.isFinite(velocityResolutionLimitMs) || velocityResolutionLimitMs <= 0 ||
      !Number.isInteger(sampleCount) || sampleCount < 0 || sampleCount > 100000 ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("Require positive frame rate, range and velocity resolution, 0–100000 samples, and a uint32 seed.");
  }

  const random = sampleRandom(seed);
  const candidates = [];
  const seen = new Set();
  const stats = { seed, requestedSamples: sampleCount, sampledTrials: 0,
    acceptedSamples: 0, anchorProfiles: 0, duplicates: 0, rejected: 0 };
  const frameMs = 1000 / frameRateHz;
  const maxActiveMs = 0.5 * frameMs;
  const maxL3Loops = Object.fromEntries(SAMPLE_FFT_BINS.map((bins) =>
    [bins, samplerLimits.aopMaxLoopsForL3(bins, SAMPLE_TX, SAMPLE_RX)]));

  const add = (inputs, source) => {
    const model = samplerLimits.aopQuantizedProfile({ ...inputs,
      txCount: SAMPLE_TX, rxCount: SAMPLE_RX });
    const activeMs = SAMPLE_TX * inputs.loops * model.chirpSeconds * 1000;
    const adcUs = inputs.adcSamples * 1000 / inputs.sampleRateKsps;
    if (model.l3.fftRangeBins === 1024 || model.l3.freeBytes < 0 ||
        model.actualStartGHz < 60 - 1e-5 || model.endGHz > SAMPLE_RF_END_GHZ ||
        model.usableRangeM < requiredRangeM + SAMPLE_RANGE_MARGIN_M ||
        model.dopplerResolutionMs > velocityResolutionLimitMs ||
        inputs.adcStartUs + adcUs > model.actualRampUs ||
        activeMs > maxActiveMs || frameMs - activeMs < 0.3 ||
        inputs.loops % 2 !== 0 || inputs.loops > 255 ||
        inputs.sampleRateKsps < 2000 || inputs.sampleRateKsps > 12500 ||
        SAMPLE_RX * Math.ceil(inputs.adcSamples * 4 / 16) * 16 > 32 * 1024) {
      stats.rejected++;
      return;
    }
    const key = profileKey({ ...inputs, ...model });
    if (seen.has(key)) {
      stats.duplicates++;
      return;
    }
    seen.add(key);
    candidates.push(candidateFromModel(model, inputs, source));
    if (source === "sampled") stats.acceptedSamples++;
    else stats.anchorProfiles++;
  };

  // Retain the earlier target-directed search, then sample around and beyond it.
  for (const anchor of samplerAnchorSearch({ frameRateHz, requiredRangeM,
    velocityResolutionLimitMs }).candidates) {
    add({ startGHz: 60, idleUs: anchor.idleUs, adcStartUs: 7,
      rampUs: anchor.rampUs, slopeMHzUs: anchor.slopeMHzUs,
      adcSamples: anchor.adcSamples, sampleRateKsps: anchor.sampleRateKsps,
      loops: anchor.loops }, "anchor");
  }

  for (let i = 0; i < sampleCount; i++) {
    stats.sampledTrials++;
    const fftBins = SAMPLE_FFT_BINS[i % SAMPLE_FFT_BINS.length];
    const stratum = Math.floor(i / SAMPLE_FFT_BINS.length);
    const firstSamples = fftBins === 64 ? 64 : fftBins / 2 + 4;
    const count = Math.floor((fftBins - firstSamples) / 4) + 1;
    const adcSamples = stratum % 13 === 0 ? fftBins :
      firstSamples + 4 * sampleInt(random, 0, count - 1);
    const sampleRateKsps = stratum % 3 === 0 ? SAMPLE_RATES_KSPS[sampleInt(random, 0, SAMPLE_RATES_KSPS.length - 1)] :
      sampleInt(random, 2000, 12500);
    const startGHz = stratum % 4 === 0 ? 60 :
      (stratum % 4 === 1 ? 60 + random() * 0.5 : 60 + random() * 3.5);
    const adcUs = adcSamples * 1000 / sampleRateKsps;
    const minimumRampUs = Math.ceil(7 + adcUs + 2);
    const rampUs = minimumRampUs + (stratum % 3 === 0 ? 0 : sampleInt(random, 0, 30));
    const maximumByMinChirp = Math.floor(maxActiveMs * 1000 /
      (SAMPLE_TX * (rampUs + 10)));
    const loops = sampleEvenLoops(random,
      Math.min(maxL3Loops[fftBins], maximumByMinChirp), stratum);
    if (loops < 2) { stats.rejected++; continue; }

    const usableBeatHz = Math.min(0.8 * sampleRateKsps * 1000, 10e6);
    const rangeSlope = samplerLimits.AOP_SDK36_LIMITS.speedOfLight * usableBeatHz /
      (2 * (requiredRangeM + SAMPLE_RANGE_MARGIN_M) * 1e12);
    const rfSlope = (SAMPLE_RF_END_GHZ - startGHz) * 1000 / rampUs;
    const maxSlope = Math.min(120, rangeSlope, rfSlope);
    const slopeStep = 2.7 * 1000 * 900 / 2 ** 26;
    const maxSlopeRegister = Math.floor(maxSlope / slopeStep);
    if (maxSlopeRegister < 1) { stats.rejected++; continue; }
    const fractions = [1, 0.98, 0.9, 0.75, 0.5];
    const fraction = stratum % 7 < fractions.length ? fractions[stratum % 7] : 0.15 + 0.85 * random();
    const slopeRegister = Math.max(1, Math.floor(maxSlopeRegister * fraction));
    const slopeMHzUs = (slopeRegister + 0.1) * slopeStep;

    const probe = samplerLimits.aopQuantizedProfile({ startGHz, idleUs: 10,
      adcStartUs: 7, rampUs, slopeMHzUs, adcSamples, sampleRateKsps,
      loops, txCount: SAMPLE_TX, rxCount: SAMPLE_RX });
    const neededPeriodUs = samplerLimits.AOP_SDK36_LIMITS.speedOfLight /
      (2 * probe.centerHz * SAMPLE_TX * loops * velocityResolutionLimitMs) * 1e6;
    const minIdleUs = Math.max(10, Math.ceil((neededPeriodUs - rampUs) * 100 + 1) / 100);
    const maxIdleUs = Math.min(5242, maxActiveMs * 1000 / (SAMPLE_TX * loops) - rampUs);
    if (minIdleUs > maxIdleUs) { stats.rejected++; continue; }
    const idleUs = stratum % 5 < 3 ? minIdleUs :
      minIdleUs + random() * Math.min(20, maxIdleUs - minIdleUs);
    add({ startGHz, idleUs, adcStartUs: 7, rampUs, slopeMHzUs,
      adcSamples, sampleRateKsps, loops }, "sampled");
  }

  candidates.sort((a, b) => a.rangeResolutionM - b.rangeResolutionM ||
    b.maxVelocityMs - a.maxVelocityMs);
  const frontier = [];
  let fastest = -Infinity;
  for (const candidate of candidates) {
    if (candidate.maxVelocityMs > fastest + 1e-6) {
      frontier.push(candidate);
      fastest = candidate.maxVelocityMs;
    }
  }
  const summaries = SAMPLE_FFT_BINS.map((fftBins) => {
    const finest = candidates.find((row) => row.fftBins === fftBins);
    if (!finest) return null;
    return candidates.filter((row) => row.fftBins === fftBins &&
      row.rangeResolutionM <= finest.rangeResolutionM * 1.001)
      .reduce((best, row) => row.maxVelocityMs > best.maxVelocityMs ? row : best, finest);
  }).filter(Boolean);
  return { candidates, frontier, summaries, stats };
}

if (typeof module !== "undefined") module.exports = { aopSampleProfiles,
  SAMPLE_FFT_BINS };
