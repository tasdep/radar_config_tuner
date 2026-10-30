// Summary-only feasible envelope for the pinned SDK 3.6 xwr64xx AOP demo.
const possibilitiesLimits = typeof module !== "undefined" ?
  require("./sdk36-aop-limits.js") : aopSdk36Limits;

const POSSIBILITY_SAMPLE_RATES_KSPS = [2000, 2500, 3000, 4000, 6000, 8000, 9142, 10000, 12000];
const POSSIBILITY_FFT_BINS = [64, 128, 256, 512];
const POSSIBILITY_RANGE_MARGIN_M = 0.1;
const POSSIBILITY_RF_END_GHZ = 63.9;

function aopPossibilities({ velocityResolutionLimitMs, frameRateHz, requiredRangeM }) {
  if (!Number.isFinite(velocityResolutionLimitMs) || velocityResolutionLimitMs <= 0 ||
      !Number.isFinite(frameRateHz) || frameRateHz <= 0 ||
      !Number.isFinite(requiredRangeM) || requiredRangeM <= 0) {
    throw new Error("Velocity resolution, frame rate, and range must be positive.");
  }
  const targetMs = velocityResolutionLimitMs - 0.0001;
  const frameMs = 1000 / frameRateHz;
  const maxActiveMs = frameMs * 0.5;
  const candidates = [];
  const summaries = [];
  for (const fftBins of POSSIBILITY_FFT_BINS) {
      const firstSamples = fftBins === 64 ? 64 : fftBins / 2 + 4;
      const maxL3Loops = possibilitiesLimits.aopMaxLoopsForL3(fftBins, 3, 4,
        possibilitiesLimits.AOP_SDK36_LIMITS.solverL3ReserveBytes);
      let best = null;
      for (const sampleRateKsps of POSSIBILITY_SAMPLE_RATES_KSPS) {
        for (let adcSamples = firstSamples; adcSamples <= fftBins; adcSamples += 4) {
          const adcUs = adcSamples * 1000 / sampleRateKsps;
          const rampUs = Math.ceil(7 + adcUs + 2);
          const budgetLoops = Math.floor(maxActiveMs * 1000 / (3 * (rampUs + 10)));
          const loops = Math.min(maxL3Loops, budgetLoops);
          const evenLoops = loops - loops % 2;
          if (evenLoops < 2) continue;
          const rangeSlope = possibilitiesLimits.AOP_SDK36_LIMITS.speedOfLight *
            0.8 * sampleRateKsps * 1000 /
            (2 * (requiredRangeM + POSSIBILITY_RANGE_MARGIN_M) * 1e12);
          const bandSlope = (POSSIBILITY_RF_END_GHZ - 60) * 1000 / rampUs;
          const slopeRegister = Math.floor(Math.min(rangeSlope, bandSlope, 120) *
            2 ** 26 / (2.7 * 1000 * 900));
          if (slopeRegister < 1) continue;
          const slopeMHzUs = (slopeRegister + 0.1) * 2.7 * 1000 * 900 / 2 ** 26;
          const probe = possibilitiesLimits.aopQuantizedProfile({
            startGHz: 60, idleUs: 10, adcStartUs: 7, rampUs,
            slopeMHzUs, adcSamples, sampleRateKsps, loops: evenLoops, txCount: 3, rxCount: 4,
          });
          let idleUs = Math.max(10, Math.ceil(
            possibilitiesLimits.AOP_SDK36_LIMITS.speedOfLight /
            (2 * probe.centerHz * 3 * evenLoops * targetMs) * 1e6 - rampUs));
          if (idleUs > 5242) continue;
          let model = possibilitiesLimits.aopQuantizedProfile({
            startGHz: 60, idleUs, adcStartUs: 7, rampUs,
            slopeMHzUs, adcSamples, sampleRateKsps, loops: evenLoops, txCount: 3, rxCount: 4,
          });
          while (model.dopplerResolutionMs > targetMs && idleUs < 5242) {
            idleUs += 1;
            model = possibilitiesLimits.aopQuantizedProfile({
              startGHz: 60, idleUs, adcStartUs: 7, rampUs,
              slopeMHzUs, adcSamples, sampleRateKsps, loops: evenLoops, txCount: 3, rxCount: 4,
            });
          }
          const activeMs = 3 * evenLoops * model.chirpSeconds * 1000;
          if (model.dopplerResolutionMs > targetMs ||
              model.usableRangeM < requiredRangeM + POSSIBILITY_RANGE_MARGIN_M ||
              model.endGHz > POSSIBILITY_RF_END_GHZ ||
              activeMs > maxActiveMs ||
              frameMs - activeMs < 0.3 ||
              model.l3.freeBytes < 64 * 1024) continue;
          const candidate = {
            requiredRangeM, fftBins,
            rangeResolutionM: model.rangeResolutionM,
            maxVelocityMs: model.maxVelocityMs,
            usableRangeM: model.usableRangeM,
            velocityResolutionMs: model.dopplerResolutionMs,
            // Retain inputs for source-level verification; the view never displays them.
            adcSamples, sampleRateKsps, loops: evenLoops, idleUs, rampUs, slopeMHzUs,
          };
          candidates.push(candidate);
          if (!best || candidate.rangeResolutionM < best.rangeResolutionM - 1e-7 ||
              (Math.abs(candidate.rangeResolutionM - best.rangeResolutionM) <= 1e-7 &&
               candidate.maxVelocityMs > best.maxVelocityMs)) best = candidate;
        }
      }
      if (best) summaries.push(best);
  }
  candidates.sort((a, b) => a.rangeResolutionM - b.rangeResolutionM ||
    b.maxVelocityMs - a.maxVelocityMs);
  const frontier = [];
  let fastest = -Infinity;
  for (const candidate of candidates) {
    if (candidate.maxVelocityMs > fastest + 1e-5) {
      frontier.push(candidate);
      fastest = candidate.maxVelocityMs;
    }
  }
  return { candidates, frontier, summaries };
}

if (typeof module !== "undefined") module.exports = { aopPossibilities,
  POSSIBILITY_FFT_BINS };
