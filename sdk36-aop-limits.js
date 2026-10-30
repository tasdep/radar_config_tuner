// SDK 03.06.02.00 xWR64xx AOP mmw demo, objdethwa DPC.
// This models its two L3 allocations, not every RF/BSS or processing limit.
const AOP_SDK36_LIMITS = {
  maxFrameLoops: 255, // mmWaveLink rlFrameCfg_t.numLoops
  l3Bytes: 6 * 128 * 1024,
  adcBufBytes: 32 * 1024,
  rxCount: 4,
  minAdcSamples: 64,
  maxAdcSamples: 1024,
  minSampleRateKsps: 2000,
  maxComplex1xSampleRateKsps: 12500,
  speedOfLight: 3e8, // mmwdemo_rfparser.c, not the physical 299792458 m/s
  rfFreqScaleFactor: 2.7, // xWR68xx 60 GHz mmWaveLink register encoding
  bytesPerComplexSample: 4,
  bytesPerDetectionCell: 2,
  solverL3ReserveBytes: 64 * 1024,
};

function aopNextPowerOfTwo(value) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function aopL3Usage({ adcSamples, loops, txCount, rxCount = AOP_SDK36_LIMITS.rxCount }) {
  const fftRangeBins = aopNextPowerOfTwo(adcSamples);
  // The xwr64xx demo's workaround for the 3-TX/4-RX 1024-bin EDMA jump.
  const rangeBins = fftRangeBins === 1024 && txCount * rxCount === 12 ? 1022 : fftRangeBins;
  const dopplerBins = Math.max(8, aopNextPowerOfTwo(loops));
  const radarCubeBytes = rangeBins * loops * txCount * rxCount *
    AOP_SDK36_LIMITS.bytesPerComplexSample;
  const detectionMatrixBytes = rangeBins * dopplerBins *
    AOP_SDK36_LIMITS.bytesPerDetectionCell;
  const usedBytes = radarCubeBytes + detectionMatrixBytes;
  return {
    fftRangeBins, rangeBins, dopplerBins, radarCubeBytes, detectionMatrixBytes, usedBytes,
    freeBytes: AOP_SDK36_LIMITS.l3Bytes - usedBytes,
    totalBytes: AOP_SDK36_LIMITS.l3Bytes,
  };
}

function aopMaxLoopsForL3(adcSamples, txCount, rxCount = AOP_SDK36_LIMITS.rxCount,
  reserveBytes = 0) {
  let maximum = 0;
  for (let loops = 1; loops <= AOP_SDK36_LIMITS.maxFrameLoops; loops++) {
    if (aopL3Usage({ adcSamples, loops, txCount, rxCount }).freeBytes < reserveBytes) break;
    if (loops % 2 === 0) maximum = loops;
  }
  return maximum;
}

function aopQuantizedProfile({ startGHz, idleUs, adcStartUs, rampUs, slopeMHzUs,
  adcSamples, sampleRateKsps, loops, txCount, rxCount = 4 }) {
  const rf = AOP_SDK36_LIMITS.rfFreqScaleFactor;
  const c = AOP_SDK36_LIMITS.speedOfLight;
  const startRegister = Math.trunc(startGHz * 2 ** 26 / rf);
  const slopeRegister = Math.trunc(slopeMHzUs * 2 ** 26 / (rf * 1000 * 900));
  const idleRegister = Math.trunc(idleUs * 100);
  const adcStartRegister = Math.trunc(adcStartUs * 100);
  const rampRegister = Math.trunc(rampUs * 100);
  const actualStartGHz = startRegister * rf / 2 ** 26;
  const actualSlopeMHzUs = slopeRegister * rf * 1000 * 900 / 2 ** 26;
  const actualIdleUs = idleRegister / 100;
  const actualAdcStartUs = adcStartRegister / 100;
  const actualRampUs = rampRegister / 100;
  const adcSeconds = adcSamples / (sampleRateKsps * 1000);
  const slopeHzS = actualSlopeMHzUs * 1e12;
  const centerHz = actualStartGHz * 1e9 + slopeHzS *
    (actualAdcStartUs * 1e-6 + adcSeconds / 2);
  const chirpSeconds = (actualIdleUs + actualRampUs) * 1e-6;
  const l3 = aopL3Usage({ adcSamples, loops, txCount, rxCount });
  const rangeResolutionM = c * sampleRateKsps * 1000 / (2 * slopeHzS * adcSamples);
  const rangeStepM = c * sampleRateKsps * 1000 / (2 * slopeHzS * l3.fftRangeBins);
  const dopplerStepMs = c / (2 * l3.dopplerBins * txCount * centerHz * chirpSeconds);
  const dopplerResolutionMs = c / (2 * loops * txCount * centerHz * chirpSeconds);
  const maxVelocityMs = l3.dopplerBins / 2 * dopplerStepMs;
  const usableBeatHz = Math.min(sampleRateKsps * 1000 * 0.8, 10e6);
  const usableRangeM = c * usableBeatHz / (2 * slopeHzS);
  return {
    startRegister, slopeRegister, idleRegister, adcStartRegister, rampRegister,
    actualStartGHz, actualSlopeMHzUs, actualIdleUs, actualAdcStartUs, actualRampUs,
    endGHz: actualStartGHz + actualSlopeMHzUs * actualRampUs / 1000,
    adcSeconds, centerHz, chirpSeconds, l3,
    rangeResolutionM, rangeStepM,
    fftRangeSpanM: rangeStepM * l3.fftRangeBins,
    lastRangeBinM: rangeStepM * (l3.rangeBins - 1),
    dopplerStepMs, dopplerResolutionMs, maxVelocityMs, usableRangeM,
    hpf2CornerRangeM: c * 350000 / (2 * slopeHzS),
  };
}

const aopSdk36Limits = { AOP_SDK36_LIMITS, aopL3Usage, aopMaxLoopsForL3,
  aopQuantizedProfile };
if (typeof module !== "undefined") module.exports = aopSdk36Limits;
