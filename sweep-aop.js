#!/usr/bin/env node
// Reproducible SDK 3.6 xWR64xx AOP three-TX design-space sweep.
const { AOP_SDK36_LIMITS, aopMaxLoopsForL3, aopQuantizedProfile } =
  require("./sdk36-aop-limits.js");

const C = AOP_SDK36_LIMITS.speedOfLight;
const TARGET_DOPPLER_MS = 0.0509; // margin below the requested hard 0.051
const FRAME_MS = 100;
const DUTY_LIMIT_MS = 50;
const ADC_START_US = 7;
const ADC_GUARD_US = 2;
const RF_END_LIMIT_GHZ = 63.9; // 100 MHz margin below hard 64 GHz VCO edge
const TX = 3;
const RX = 4;
const sampleRates = [2000, 2500, 3000, 4000, 6000, 8000, 9142, 10000, 12000];
const rangeTargets = [20, 21, 22];
const rows = [];

for (const requestedRangeM of rangeTargets) {
  for (const sampleRateKsps of sampleRates) {
    for (let adcSamples = 64; adcSamples <= 1024; adcSamples += 4) {
      const adcUs = adcSamples * 1000 / sampleRateKsps;
      const rampUs = Math.ceil(ADC_START_US + adcUs + ADC_GUARD_US);
      const bandSlope = (RF_END_LIMIT_GHZ - 60) * 1000 / rampUs;
      const rangeSlope = C * 0.8 * sampleRateKsps * 1000 /
        (2 * requestedRangeM * 1e12);
      const slopeRegister = Math.floor(Math.min(bandSlope, rangeSlope, 120) *
        2 ** 26 / (2.7 * 1000 * 900));
      if (slopeRegister <= 0) continue;
      // Express a slope that encodes to exactly this register after CLI truncation.
      const slopeMHzUs = (slopeRegister + 0.1) * 2.7 * 1000 * 900 / 2 ** 26;
      const loops = aopMaxLoopsForL3(adcSamples, TX, RX);
      if (loops < 2) continue;
      const probe = aopQuantizedProfile({
        startGHz: 60, idleUs: 10, adcStartUs: ADC_START_US, rampUs,
        slopeMHzUs, adcSamples, sampleRateKsps, loops, txCount: TX, rxCount: RX,
      });
      let idleUs = Math.max(10, Math.ceil(C /
        (2 * probe.centerHz * TX * loops * TARGET_DOPPLER_MS) * 1e6 - rampUs));
      let model = aopQuantizedProfile({
        startGHz: 60, idleUs, adcStartUs: ADC_START_US, rampUs,
        slopeMHzUs, adcSamples, sampleRateKsps, loops, txCount: TX, rxCount: RX,
      });
      while (model.dopplerResolutionMs > TARGET_DOPPLER_MS && idleUs < 5242) {
        idleUs += 1;
        model = aopQuantizedProfile({
          startGHz: 60, idleUs, adcStartUs: ADC_START_US, rampUs,
          slopeMHzUs, adcSamples, sampleRateKsps, loops, txCount: TX, rxCount: RX,
        });
      }
      const activeMs = TX * loops * model.chirpSeconds * 1000;
      if (model.dopplerResolutionMs > TARGET_DOPPLER_MS || idleUs > 5242 ||
          activeMs > DUTY_LIMIT_MS || FRAME_MS - activeMs < 0.3 ||
          model.endGHz > RF_END_LIMIT_GHZ || model.usableRangeM < requestedRangeM ||
          model.usableRangeM > 22.6 || model.l3.freeBytes < 0) continue;
      const hpf2CornerM = C * 350000 / (2 * model.actualSlopeMHzUs * 1e12);
      rows.push({
        requestedRangeM, adcSamples, sampleRateKsps,
        sdkSupported: model.l3.fftRangeBins !== 1024,
        slopeMHzUs: Number(slopeMHzUs.toFixed(6)),
        slopeRegister: model.slopeRegister,
        rampUs, idleUs, loops,
        fftRangeBins: model.l3.fftRangeBins,
        processedRangeBins: model.l3.rangeBins,
        usableRangeM: Number(model.usableRangeM.toFixed(4)),
        rangeResolutionM: Number(model.rangeResolutionM.toFixed(6)),
        rangeBinStepM: Number(model.rangeStepM.toFixed(6)),
        dopplerResolutionMs: Number(model.dopplerResolutionMs.toFixed(6)),
        dopplerBinStepMs: Number(model.dopplerStepMs.toFixed(6)),
        maxVelocityMs: Number(model.maxVelocityMs.toFixed(5)),
        hpf2CornerM: Number(hpf2CornerM.toFixed(3)),
        endGHz: Number(model.endGHz.toFixed(6)),
        l3UsedKiB: Number((model.l3.usedBytes / 1024).toFixed(3)),
        l3FreeKiB: Number((model.l3.freeBytes / 1024).toFixed(3)),
        activeMs: Number(activeMs.toFixed(3)),
      });
    }
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({
    model: "SDK 03.06.02.00 xWR64xx AOP; 3 TX, 4 RX, 100 ms frame, 50% duty",
    note: "1024 FFT-bin rows are theoretical only: rangeprochwa.h documents 3-TX/4-RX mode as unsupported, and one 576-sample/14-loop bench run lost CLI at sensorStart despite the demo's 1022-bin workaround.",
    dopplerLimitMs: 0.051, designMarginMs: TARGET_DOPPLER_MS,
    adcStartUs: ADC_START_US, adcGuardUs: ADC_GUARD_US,
    rfEndLimitGHz: RF_END_LIMIT_GHZ,
    sampleRatesKsps: sampleRates, requestedRangesM: rangeTargets,
    rows,
  }, null, 2) + "\n");
} else {
  const columns = Object.keys(rows[0] || {});
  process.stdout.write(columns.join(",") + "\n");
  for (const row of rows) process.stdout.write(columns.map((key) => row[key]).join(",") + "\n");
}
