// SDK 03.06.02.00 xWR64xx AOP mmw demo, objdethwa DPC.
// This models its two L3 allocations, not every RF/BSS or processing limit.
const AOP_SDK36_LIMITS = {
  maxFrameLoops: 255, // mmWaveLink rlFrameCfg_t.numLoops
  l3Bytes: 6 * 128 * 1024,
  rxCount: 4,
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
  const rangeBins = aopNextPowerOfTwo(adcSamples);
  const dopplerBins = aopNextPowerOfTwo(loops);
  const radarCubeBytes = rangeBins * loops * txCount * rxCount *
    AOP_SDK36_LIMITS.bytesPerComplexSample;
  const detectionMatrixBytes = rangeBins * dopplerBins *
    AOP_SDK36_LIMITS.bytesPerDetectionCell;
  const usedBytes = radarCubeBytes + detectionMatrixBytes;
  return {
    rangeBins, dopplerBins, radarCubeBytes, detectionMatrixBytes, usedBytes,
    freeBytes: AOP_SDK36_LIMITS.l3Bytes - usedBytes,
    totalBytes: AOP_SDK36_LIMITS.l3Bytes,
  };
}

function aopMaxLoopsForL3(adcSamples, txCount, rxCount = AOP_SDK36_LIMITS.rxCount,
  reserveBytes = 0) {
  let maximum = 0;
  for (let loops = 1; loops <= AOP_SDK36_LIMITS.maxFrameLoops; loops++) {
    if (aopL3Usage({ adcSamples, loops, txCount, rxCount }).freeBytes < reserveBytes) break;
    maximum = loops;
  }
  return maximum;
}

const aopSdk36Limits = { AOP_SDK36_LIMITS, aopL3Usage, aopMaxLoopsForL3 };
if (typeof module !== "undefined") module.exports = aopSdk36Limits;
