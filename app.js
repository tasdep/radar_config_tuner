const C = 299792458.0;
const NUM_TX = 3;

const DEVICES = {
  "6843": {
    name: "IWR6843AOP",
    startFreqGHz: 60,
    platform: "xWR68xx_AOP",
    azimuth: "30 + 30",
    rxGain: 158,
    comp: "0.0 1 0 -1 0 1 0 -1 0 1 0 -1 0 1 0 -1 0 1 0 -1 0 1 0 -1 0",
    defaultDopplerGate: 2.05,
  },
  "1843": {
    name: "AWR1843AOP",
    startFreqGHz: 77,
    platform: "xWR18xx_AOP",
    azimuth: "30 + 38",
    rxGain: 30,
    comp: "0.0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0",
    defaultDopplerGate: 2.05,
  },
};

const state = {
  device: "6843",
  frameRate: 10,
  rangeGate: 20,
  maxVelocityTarget: 2.05,
  velocityResolutionTarget: 0.06,
  rangeResolutionTarget: 0.2,
  dutyLimit: 50,
  adcSamples: 128,
  sampleRate: 9142,
  slope: 54,
  idleTime: 179,
  rampEndTime: 23,
  numLoops: 80,
  rangeThreshold: 15,
  dopplerThreshold: 15,
};

const ids = [
  "device",
  "frameRate",
  "rangeGate",
  "maxVelocityTarget",
  "velocityResolutionTarget",
  "rangeResolutionTarget",
  "dutyLimit",
  "adcSamples",
  "sampleRate",
  "slope",
  "idleTime",
  "rampEndTime",
  "numLoops",
  "rangeThreshold",
  "dopplerThreshold",
];

const targetIds = new Set([
  "device",
  "frameRate",
  "rangeGate",
  "maxVelocityTarget",
  "velocityResolutionTarget",
  "rangeResolutionTarget",
  "dutyLimit",
  "adcSamples",
]);

const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function nextPowerOfTwo(value) {
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

function fmt(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function currentDevice() {
  return DEVICES[state.device];
}

function metricsFor(params) {
  const device = DEVICES[params.device];
  const sampleRateHz = params.sampleRate * 1000;
  const slopeHzPerS = params.slope * 1e12;
  const adcSamples = params.adcSamples;
  const numRangeBins = nextPowerOfTwo(adcSamples);
  const adcTime = adcSamples / sampleRateHz;
  const bandwidth = slopeHzPerS * adcTime;
  const rangeResolution = C / (2 * bandwidth);
  const rangeStep = C * sampleRateHz / (2 * slopeHzPerS * numRangeBins);
  const fftRangeSpan = rangeStep * numRangeBins;
  const chirpPeriod = (params.idleTime + params.rampEndTime) * 1e-6;
  const framePeriod = 1 / params.frameRate;
  const activeTime = NUM_TX * params.numLoops * chirpPeriod;
  const duty = activeTime / framePeriod;
  const centerFreq =
    device.startFreqGHz * 1e9 +
    slopeHzPerS * (7e-6 + adcTime / 2);
  const maxVelocity = C / (4 * centerFreq * chirpPeriod * NUM_TX);
  const velocityResolution =
    C / (2 * centerFreq * chirpPeriod * NUM_TX * params.numLoops);
  const chirpsPerFrame = NUM_TX * params.numLoops;
  const adcFits = adcTime * 1e6 + 7 <= params.rampEndTime;

  return {
    sampleRateHz,
    slopeHzPerS,
    adcTime,
    bandwidth,
    rangeResolution,
    rangeStep,
    fftRangeSpan,
    chirpPeriod,
    framePeriod,
    activeTime,
    duty,
    centerFreq,
    maxVelocity,
    velocityResolution,
    chirpsPerFrame,
    numRangeBins,
    adcFits,
  };
}

function metrics() {
  return metricsFor(state);
}

function dutyBudget() {
  return Math.min(state.dutyLimit, 50);
}

function targetBounds() {
  const adcBins = nextPowerOfTwo(state.adcSamples);
  const sampleRateHz = state.sampleRate * 1000;
  const device = currentDevice();
  const adcTimeUs = state.adcSamples / sampleRateHz * 1e6;
  const minRampUs = Math.max(10, Math.ceil(adcTimeUs + 8));
  const rangeSpanFromTarget = state.rangeResolutionTarget * adcBins;
  const minRangeResolutionForGate = state.rangeGate / adcBins;
  const centerFreq =
    device.startFreqGHz * 1e9 +
    state.slope * 1e12 * (7e-6 + (state.adcSamples / sampleRateHz) / 2);
  const minChirpUs = minRampUs + 10;
  const maxVelocityFromTiming = C / (4 * centerFreq * minChirpUs * 1e-6 * NUM_TX);
  const chirpForVelocityUs =
    C / (4 * centerFreq * NUM_TX * state.maxVelocityTarget) * 1e6;
  const chirpUs = Math.max(minChirpUs, chirpForVelocityUs);
  const frameBudgetUs = (1000000 / state.frameRate) * dutyBudget() / 100;
  const maxLoops = Math.max(1, Math.min(256, Math.floor(frameBudgetUs / (NUM_TX * chirpUs))));
  const minVelocityResolution =
    C / (2 * centerFreq * chirpUs * 1e-6 * NUM_TX * maxLoops);
  const minDutyPercent = Math.ceil((NUM_TX * maxLoops * chirpUs) / (1000000 / state.frameRate) * 100);

  return {
    frameRate: {
      min: 1,
      max: 30,
      text: "set before solving timing budget",
    },
    rangeGate: {
      min: 2,
      max: Math.max(2, Math.min(30, rangeSpanFromTarget)),
      text: `range res target gives up to ${fmt(rangeSpanFromTarget, 1)} m with ${adcBins} bins`,
    },
    maxVelocityTarget: {
      min: 0.5,
      max: Math.max(0.5, Math.min(8, maxVelocityFromTiming)),
      text: `minimum chirp period allows ${fmt(maxVelocityFromTiming, 2)} m/s`,
    },
    velocityResolutionTarget: {
      min: Math.max(0.02, Math.min(0.5, minVelocityResolution)),
      max: 0.5,
      text: `best at current speed/duty is ${fmt(minVelocityResolution, 4)} m/s`,
    },
    rangeResolutionTarget: {
      min: Math.max(0.03, Math.min(0.5, minRangeResolutionForGate)),
      max: 0.5,
      text: `output range needs at least ${fmt(minRangeResolutionForGate, 3)} m with ${adcBins} bins`,
    },
    dutyLimit: {
      min: Math.max(30, Math.min(50, minDutyPercent)),
      max: 50,
      text: `current speed target needs about ${minDutyPercent}% active chirp time`,
    },
  };
}

function applyTargetBounds(bounds) {
  for (const [id, bound] of Object.entries(bounds)) {
    const el = els[id];
    if (!el) continue;
    const step = Number(el.step || 1);
    const min = Number(bound.min.toFixed(4));
    const max = Number(bound.max.toFixed(4));
    el.min = min;
    el.max = Math.max(min, max);
    if (state[id] < min) state[id] = min;
    if (state[id] > max) state[id] = max;
    if (step >= 1) state[id] = Math.round(state[id]);
  }
}

function solveTargets() {
  const device = currentDevice();
  const sampleRateHz = state.sampleRate * 1000;
  const adcTimeUs = state.adcSamples / sampleRateHz * 1e6;
  const minRamp = Math.max(10, Math.ceil(adcTimeUs + 8));
  const maxSlopeForRange =
    C * sampleRateHz / (2 * state.rangeGate * 1e12);
  const slopeForResolution =
    C * sampleRateHz / (2 * state.adcSamples * state.rangeResolutionTarget * 1e12);
  state.slope = Math.max(10, Math.min(120, Math.min(maxSlopeForRange, Math.max(10, slopeForResolution))));
  state.rampEndTime = Math.max(minRamp, Math.min(80, state.rampEndTime));

  const slopeHzPerS = state.slope * 1e12;
  const centerFreq =
    device.startFreqGHz * 1e9 +
    slopeHzPerS * (7e-6 + state.adcSamples / sampleRateHz / 2);
  const chirpForVelocityUs =
    C / (4 * centerFreq * NUM_TX * state.maxVelocityTarget) * 1e6;
  const chirpUs = Math.max(state.rampEndTime + 10, Math.floor(chirpForVelocityUs));
  state.idleTime = Math.max(10, Math.round(chirpUs - state.rampEndTime));

  const budgetUs = (1000000 / state.frameRate) * dutyBudget() / 100;
  const loopsForResolution =
    C / (2 * centerFreq * (state.idleTime + state.rampEndTime) * 1e-6 * NUM_TX * state.velocityResolutionTarget);
  const maxLoops = Math.floor(budgetUs / (NUM_TX * (state.idleTime + state.rampEndTime)));
  state.numLoops = Math.max(1, Math.min(256, Math.floor(Math.min(maxLoops, Math.max(Math.ceil(loopsForResolution), 1)))));
}

function optimizeVelocity() {
  solveTargets();
  syncInputs();
  render();
}

function statusItems(m) {
  const items = [];
  const dutyLimit = state.dutyLimit / 100;
  const rangeOk = m.fftRangeSpan >= state.rangeGate;
  const velocityOk = m.maxVelocity >= state.maxVelocityTarget;
  const velocityResolutionOk = m.velocityResolution <= state.velocityResolutionTarget;
  const rangeResolutionOk = m.rangeResolution <= state.rangeResolutionTarget;
  const dutyOk = m.duty <= dutyLimit;
  const adcFits = m.adcFits;

  items.push({
    level: rangeOk ? "ok" : "bad",
    label: rangeOk ? "Range span clears output gate" : "Range span below output gate",
    value: `${fmt(m.fftRangeSpan, 2)} m span vs ${fmt(state.rangeGate, 1)} m gate`,
  });
  items.push({
    level: velocityOk ? "ok" : "bad",
    label: velocityOk ? "Max radial velocity clears target" : "Max radial velocity below target",
    value: `${fmt(m.maxVelocity, 3)} m/s vs ${fmt(state.maxVelocityTarget, 2)} m/s`,
  });
  items.push({
    level: velocityResolutionOk ? "ok" : "warn",
    label: velocityResolutionOk ? "Velocity resolution clears target" : "Velocity resolution above target",
    value: `${fmt(m.velocityResolution, 4)} m/s vs ${fmt(state.velocityResolutionTarget, 4)} m/s`,
  });
  items.push({
    level: rangeResolutionOk ? "ok" : "warn",
    label: rangeResolutionOk ? "Range resolution clears target" : "Range resolution above target",
    value: `${fmt(m.rangeResolution, 4)} m vs ${fmt(state.rangeResolutionTarget, 4)} m`,
  });
  items.push({
    level: dutyOk ? "ok" : "warn",
    label: dutyOk ? "Active chirp budget OK" : "Active chirp budget tight",
    value: `${fmt(m.duty * 100, 1)}% active vs ${state.dutyLimit}% target`,
  });
  items.push({
    level: adcFits ? "ok" : "bad",
    label: adcFits ? "ADC capture fits ramp" : "ADC capture exceeds ramp",
    value: `${fmt(m.adcTime * 1e6, 2)} us ADC plus 7 us start, ${fmt(state.rampEndTime, 2)} us ramp`,
  });
  if (Math.abs(m.fftRangeSpan - state.rangeGate) < 0.75) {
    items.push({
      level: "warn",
      label: "Range span has little margin",
      value: "TI visualizer/hardware validation recommended",
    });
  }
  return items;
}

function generateConfig(m) {
  const device = currentDevice();
  const frameMs = 1000 / state.frameRate;
  const gate = Math.min(state.rangeGate, m.fftRangeSpan);
  const dopplerGate = Math.min(state.maxVelocityTarget, m.maxVelocity);
  const name = `${state.device === "6843" ? "6843" : "1843"}AOP_vel_res_range_gui.cfg`;

  const lines = [
    "% ***************************************************************",
    "% Created for SDK ver:03.06",
    "% Created using radar_config_tuner",
    `% Frequency:${device.startFreqGHz}`,
    `% Platform:${device.platform}`,
    "% Scene Classifier:vel_res_range_gui",
    `% Azimuth Resolution(deg):${device.azimuth}`,
    `% Range Resolution(m):${fmt(m.rangeResolution, 3)}`,
    `% Maximum unambiguous Range(m):${fmt(m.fftRangeSpan, 2)} FFT span`,
    `% Maximum Radial Velocity(m/s):${fmt(m.maxVelocity, 3)}`,
    `% Radial velocity resolution(m/s):${fmt(m.velocityResolution, 4)}`,
    `% Frame Duration(msec):${fmt(frameMs, 3)}`,
    "% RF calibration data:None",
    `% Range Detection Threshold (dB):${state.rangeThreshold}`,
    `% Doppler Detection Threshold (dB):${state.dopplerThreshold}`,
    "% Range Peak Grouping:enabled",
    "% Doppler Peak Grouping:enabled",
    "% Static clutter removal:disabled",
    "% Angle of Arrival FoV: Full FoV",
    `% Range FoV:0-${fmt(gate, 2)} m`,
    `% Doppler FoV:+/-${fmt(dopplerGate, 2)} m/s`,
    "% ***************************************************************",
    "sensorStop",
    "flushCfg",
    "dfeDataOutputMode 1",
    "channelCfg 15 7 0",
    "adcCfg 2 1",
    "adcbufCfg -1 0 1 1 1",
    `profileCfg 0 ${device.startFreqGHz} ${Math.round(state.idleTime)} 7 ${fmt(state.rampEndTime, 2).replace(/\\.00$/, "")} 0 0 ${fmt(state.slope, 1).replace(/\\.0$/, "")} 1 ${state.adcSamples} ${Math.round(state.sampleRate)} 0 0 ${device.rxGain}`,
    "chirpCfg 0 0 0 0 0 0 0 1",
    "chirpCfg 1 1 0 0 0 0 0 2",
    "chirpCfg 2 2 0 0 0 0 0 4",
    `frameCfg 0 2 ${state.numLoops} 0 ${fmt(frameMs, 3).replace(/\\.000$/, "")} 1 0`,
    "lowPower 0 0",
    "guiMonitor -1 1 0 0 0 0 1",
    `cfarCfg -1 0 2 8 4 3 0 ${state.rangeThreshold} 1`,
    `cfarCfg -1 1 0 8 4 4 1 ${state.dopplerThreshold} 1`,
    "multiObjBeamForming -1 1 0.5",
    "clutterRemoval -1 0",
    "calibDcRangeSig -1 0 -5 8 256",
    "extendedMaxVelocity -1 0",
    "lvdsStreamCfg -1 0 0 0",
    `compRangeBiasAndRxChanPhase ${device.comp}`,
    "measureRangeBiasAndRxChanPhase 0 1.5 0.2",
    "CQRxSatMonitor 0 3 4 19 0",
    "CQSigImgMonitor 0 31 4",
    "analogMonitor 0 0",
    "aoaFovCfg -1 -90 90 -90 90",
    `cfarFovCfg -1 0 0 ${fmt(gate, 2).replace(/\\.00$/, "")}`,
    `cfarFovCfg -1 1 -${fmt(dopplerGate, 2)} ${fmt(dopplerGate, 2)}`,
    "calibData 0 0 0",
    "sensorStart",
  ];

  return { name, text: lines.join("\n") + "\n" };
}

function liveValues(m) {
  const device = currentDevice();
  const frameMs = 1000 / state.frameRate;
  const gate = Math.min(state.rangeGate, m.fftRangeSpan);
  const dopplerGate = Math.min(state.maxVelocityTarget, m.maxVelocity);
  const profileCfg =
    `profileCfg 0 ${device.startFreqGHz} ${Math.round(state.idleTime)} 7 ` +
    `${fmt(state.rampEndTime, 2).replace(/\.00$/, "")} 0 0 ` +
    `${fmt(state.slope, 1).replace(/\.0$/, "")} 1 ${state.adcSamples} ` +
    `${Math.round(state.sampleRate)} 0 0 ${device.rxGain}`;
  const frameCfg =
    `frameCfg 0 2 ${state.numLoops} 0 ${fmt(frameMs, 3).replace(/\.000$/, "")} 1 0`;

  return [
    ["Device", `${device.name} (${device.startFreqGHz} GHz)`],
    ["profileCfg", profileCfg],
    ["chirpCfg", "0/1/2 -> TX masks 1,2,4"],
    ["frameCfg", frameCfg],
    ["cfarFov range", `0 to ${fmt(gate, 2)} m`],
    ["cfarFov Doppler", `-${fmt(dopplerGate, 2)} to ${fmt(dopplerGate, 2)} m/s`],
    ["Range threshold", `${state.rangeThreshold} dB`],
    ["Doppler threshold", `${state.dopplerThreshold} dB`],
    ["ADC time", `${fmt(m.adcTime * 1e6, 3)} us`],
    ["Bandwidth", `${fmt(m.bandwidth / 1e6, 1)} MHz`],
    ["Center frequency", `${fmt(m.centerFreq / 1e9, 4)} GHz`],
    ["Range bins", `${m.numRangeBins}`],
    ["Chirp period", `${fmt(m.chirpPeriod * 1e6, 2)} us`],
    ["Chirps/frame", `${m.chirpsPerFrame}`],
    ["Frame period", `${fmt(frameMs, 3)} ms`],
    ["Config filename", generateConfig(m).name],
  ];
}

function timingGraphic(m) {
  const activePct = Math.max(1, Math.min(100, m.duty * 100));
  const unusedPct = Math.max(0, 100 - activePct);
  const chirpUs = m.chirpPeriod * 1e6;
  const idlePct = Math.max(6, Math.min(94, state.idleTime / chirpUs * 100));
  const rampPct = Math.max(6, 100 - idlePct);

  return `
    <div class="timing-row">
      <span>Frame</span>
      <div class="frame-track">
        <div class="frame-active" style="width:${activePct}%">active chirps</div>
        <div class="frame-unused" style="width:${unusedPct}%">unused frame</div>
      </div>
    </div>
    <div class="timing-row">
      <span>One chirp</span>
      <div class="chirp-track">
        <div class="chirp-idle" style="width:${idlePct}%">idle</div>
        <div class="chirp-ramp" style="width:${rampPct}%">ramp + ADC</div>
      </div>
    </div>
  `;
}

function detailedTiming(m) {
  const chirpUs = m.chirpPeriod * 1e6;
  const frameMs = m.framePeriod * 1000;
  const activeMs = m.activeTime * 1000;
  const adcUs = m.adcTime * 1e6;
  const rows = [];
  for (let loop = 0; loop < state.numLoops; loop++) {
    for (let tx = 0; tx < NUM_TX; tx++) {
      const index = loop * NUM_TX + tx;
      const startUs = index * chirpUs;
      const rampStartUs = startUs + state.idleTime;
      const adcStartUs = rampStartUs + 7;
      rows.push(`
        <tr>
          <td>${index + 1}</td>
          <td>${loop + 1}</td>
          <td>${tx}</td>
          <td><span class="tx-tag tx-${tx + 1}">TX${tx + 1}</span></td>
          <td>${fmt(startUs / 1000, 4)}</td>
          <td>${fmt(rampStartUs / 1000, 4)}</td>
          <td>${fmt(adcStartUs / 1000, 4)}–${fmt((adcStartUs + adcUs) / 1000, 4)}</td>
          <td>${fmt((startUs + chirpUs) / 1000, 4)}</td>
        </tr>
      `);
    }
  }

  return `
    <div class="frame-sequence" aria-label="Two consecutive frames">
      <div><strong>Frame 1</strong><span>0–${fmt(frameMs, 3)} ms</span><small>${m.chirpsPerFrame} chirps through ${fmt(activeMs, 3)} ms, then frame gap</small></div>
      <div><strong>Frame 2</strong><span>${fmt(frameMs, 3)}–${fmt(frameMs * 2, 3)} ms</span><small>same chirp sequence repeats</small></div>
    </div>
    <div class="loop-pattern">
      <strong>Each loop</strong>
      <span class="tx-tag tx-1">chirp 0 · TX1</span>
      <span class="tx-tag tx-2">chirp 1 · TX2</span>
      <span class="tx-tag tx-3">chirp 2 · TX3</span>
      <span>× ${state.numLoops} loops = ${m.chirpsPerFrame} chirps/frame</span>
    </div>
    <p class="timing-note">Times below are offsets from the start of frame 1. The ADC window starts 7 µs into each ramp; one chirp lasts ${fmt(chirpUs, 2)} µs.</p>
    <div class="chirp-table-scroll">
      <table class="chirp-table">
        <thead><tr><th scope="col">#</th><th scope="col">Loop</th><th scope="col">chirpCfg</th><th scope="col">TX</th><th scope="col">Start ms</th><th scope="col">Ramp starts ms</th><th scope="col">ADC window ms</th><th scope="col">End ms</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function renderDetailedTiming(m) {
  const details = document.getElementById("timingDetails");
  if (details.open) document.getElementById("timingDetailsContent").innerHTML = detailedTiming(m);
}

function cfgExplainer(m) {
  const device = currentDevice();
  const frameMs = 1000 / state.frameRate;
  const profileItems = [
    ["profile id", "0"],
    ["start frequency", `${device.startFreqGHz} GHz`],
    ["idle time", `${Math.round(state.idleTime)} us`],
    ["ADC valid start", "7 us"],
    ["ramp end", `${fmt(state.rampEndTime, 2)} us`],
    ["slope", `${fmt(state.slope, 1)} MHz/us`],
    ["TX start", "0 us"],
    ["ADC samples", `${state.adcSamples}`],
    ["sample rate", `${Math.round(state.sampleRate)} ksps`],
    ["RX gain", `${device.rxGain}`],
  ];
  const frameItems = [
    ["chirp start / end", "0 to 2"],
    ["TX pattern", "3 chirps, TX1/TX2/TX3"],
    ["loops", `${state.numLoops}`],
    ["chirps per frame", `${m.chirpsPerFrame}`],
    ["frame period", `${fmt(frameMs, 3)} ms`],
    ["active chirp time", `${fmt(m.activeTime * 1000, 3)} ms`],
    ["unused frame time", `${fmt((m.framePeriod - m.activeTime) * 1000, 3)} ms`],
    ["duty", `${fmt(m.duty * 100, 1)}%`],
  ];
  const derivedItems = [
    ["bandwidth", `${fmt(m.bandwidth / 1e6, 1)} MHz`],
    ["range bins", `${m.numRangeBins}`],
    ["FFT range span", `${fmt(m.fftRangeSpan, 2)} m`],
    ["range bin spacing", `${fmt(m.rangeStep, 4)} m`],
    ["range resolution", `${fmt(m.rangeResolution, 4)} m`],
    ["max radial velocity", `${fmt(m.maxVelocity, 3)} m/s`],
    ["velocity resolution", `${fmt(m.velocityResolution, 4)} m/s`],
    ["center frequency", `${fmt(m.centerFreq / 1e9, 4)} GHz`],
  ];
  const section = (title, items) => `
    <div class="explainer-section">
      <h3>${title}</h3>
      ${items.map(([label, value]) => `
        <div class="explainer-item">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `).join("")}
    </div>
  `;

  return [
    section("profileCfg", profileItems),
    section("frameCfg", frameItems),
    section("derived", derivedItems),
  ].join("");
}

function syncInputs() {
  els.device.value = state.device;
  els.frameRate.value = state.frameRate;
  els.rangeGate.value = state.rangeGate;
  els.maxVelocityTarget.value = state.maxVelocityTarget;
  els.velocityResolutionTarget.value = state.velocityResolutionTarget;
  els.rangeResolutionTarget.value = state.rangeResolutionTarget;
  els.dutyLimit.value = state.dutyLimit;
  els.adcSamples.value = String(state.adcSamples);
  els.sampleRate.value = state.sampleRate;
  els.slope.value = state.slope;
  els.idleTime.value = state.idleTime;
  els.rampEndTime.value = state.rampEndTime;
  els.numLoops.value = state.numLoops;
  els.rangeThreshold.value = state.rangeThreshold;
  els.dopplerThreshold.value = state.dopplerThreshold;
}

function render() {
  const bounds = targetBounds();
  applyTargetBounds(bounds);
  syncInputs();
  const m = metrics();
  document.getElementById("frameRateOut").value = `${state.frameRate} Hz`;
  document.getElementById("rangeGateOut").value = `${fmt(state.rangeGate, 1)} m`;
  document.getElementById("maxVelocityTargetOut").value = `${fmt(state.maxVelocityTarget, 2)} m/s`;
  document.getElementById("velocityResolutionTargetOut").value = `${fmt(state.velocityResolutionTarget, 3)} m/s`;
  document.getElementById("rangeResolutionTargetOut").value = `${fmt(state.rangeResolutionTarget, 3)} m`;
  document.getElementById("dutyLimitOut").value = `${state.dutyLimit}%`;
  document.getElementById("sampleRateOut").value = `${fmt(state.sampleRate / 1000, 3)} Msps`;
  document.getElementById("slopeOut").value = `${fmt(state.slope, 1)} MHz/us`;
  document.getElementById("idleTimeOut").value = `${Math.round(state.idleTime)} us`;
  document.getElementById("rampEndTimeOut").value = `${fmt(state.rampEndTime, 2)} us`;
  document.getElementById("numLoopsOut").value = `${state.numLoops}`;
  document.getElementById("rangeThresholdOut").value = `${state.rangeThreshold} dB`;
  document.getElementById("dopplerThresholdOut").value = `${state.dopplerThreshold} dB`;
  for (const [id, bound] of Object.entries(bounds)) {
    const out = document.getElementById(`${id}Bounds`);
    if (out) out.textContent = `${bound.text} (${fmt(Number(els[id].min), 3)} to ${fmt(Number(els[id].max), 3)})`;
  }

  document.getElementById("velocityResolution").textContent = `${fmt(m.velocityResolution, 4)} m/s`;
  document.getElementById("maxVelocity").textContent = `${fmt(m.maxVelocity, 3)} m/s`;
  document.getElementById("rangeResolution").textContent = `${fmt(m.rangeResolution, 4)} m`;
  document.getElementById("fftSpan").textContent = `${fmt(m.fftRangeSpan, 2)} m`;
  document.getElementById("activeTime").textContent = `${fmt(m.activeTime * 1000, 2)} ms`;
  document.getElementById("duty").textContent = `${fmt(m.duty * 100, 1)}%`;
  document.getElementById("timingGraphic").innerHTML = timingGraphic(m);
  renderDetailedTiming(m);
  document.getElementById("plotSummary").textContent =
    `${state.adcSamples} samples, ${m.numRangeBins} bins, ${m.chirpsPerFrame} chirps/frame`;
  document.getElementById("cfgExplainer").innerHTML = cfgExplainer(m);

  const status = statusItems(m);
  document.getElementById("statusList").innerHTML = status
    .map((item) => `<div class="status-item status-${item.level}"><span>${item.label}</span><strong>${item.value}</strong></div>`)
    .join("");

  const cfg = generateConfig(m);
  document.getElementById("configName").textContent = cfg.name;
  document.getElementById("configText").value = cfg.text;
  document.getElementById("liveValues").innerHTML = liveValues(m)
    .map(([label, value]) => `<div class="value-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function updateStateFromInput(event) {
  const target = event.target;
  const id = target.id;
  if (id === "device") state.device = target.value;
  else if (id === "adcSamples") state.adcSamples = Number(target.value);
  else if (id in state) state[id] = Number(target.value);
  if (targetIds.has(id)) solveTargets();
  render();
}

function downloadConfig() {
  const m = metrics();
  const cfg = generateConfig(m);
  const blob = new Blob([cfg.text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = cfg.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyConfig() {
  const text = document.getElementById("configText").value;
  await navigator.clipboard.writeText(text);
}

ids.forEach((id) => {
  els[id].addEventListener("input", updateStateFromInput);
  els[id].addEventListener("change", updateStateFromInput);
});

document.getElementById("optimizeVelocity").addEventListener("click", optimizeVelocity);
document.getElementById("downloadConfig").addEventListener("click", downloadConfig);
document.getElementById("copyConfig").addEventListener("click", copyConfig);
document.getElementById("timingDetails").addEventListener("toggle", () => renderDetailedTiming(metrics()));

solveTargets();
syncInputs();
render();
