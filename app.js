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
  priority: "velocity",
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
  usePushedMargin: false,
};

const ids = [
  "device",
  "usePushedMargin",
  "priority",
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
  return state.usePushedMargin
    ? Math.min(state.dutyLimit + 2, 55)
    : state.dutyLimit;
}

function candidateLabel(candidate, index) {
  if (index === 0) return "Best match";
  if (candidate.m.duty < state.dutyLimit / 100 - 0.08) return "Timing margin";
  if (candidate.m.rangeResolution < state.rangeResolutionTarget * 0.8) return "Sharper range";
  if (candidate.m.velocityResolution < state.velocityResolutionTarget * 0.8) return "Sharper velocity";
  return `Option ${index + 1}`;
}

function candidateScore(m) {
  const velocityRatio = m.velocityResolution / state.velocityResolutionTarget;
  const rangeRatio = m.rangeResolution / state.rangeResolutionTarget;
  const velocityHeadroom = Math.max(0, state.maxVelocityTarget / m.maxVelocity - 1) * 100;
  const rangeHeadroom = Math.max(0, state.rangeGate / m.fftRangeSpan - 1) * 100;
  const dutyHeadroom = Math.max(0, m.duty / (state.dutyLimit / 100) - 1) * 100;

  if (state.priority === "range") {
    return rangeRatio * 100 + velocityRatio * 18 + velocityHeadroom + rangeHeadroom + dutyHeadroom;
  }
  if (state.priority === "balanced") {
    return rangeRatio * 55 + velocityRatio * 55 + velocityHeadroom + rangeHeadroom + dutyHeadroom;
  }
  return velocityRatio * 100 + rangeRatio * 18 + velocityHeadroom + rangeHeadroom + dutyHeadroom;
}

function generateCandidates() {
  const sampleRates = [5209, 6250, 7500, 8333, 9142, 10000, 11000, 12500];
  const adcSamplesOptions = [64, 128, 256];
  const framePeriodUs = (1000000 / state.frameRate);
  const budgetUs = framePeriodUs * dutyBudget() / 100;
  const candidates = [];

  for (const adcSamples of adcSamplesOptions) {
    for (const sampleRate of sampleRates) {
      const adcTimeUs = adcSamples / (sampleRate * 1000) * 1e6;
      const minRamp = Math.max(10, Math.ceil(adcTimeUs + 8));

      for (let slope = 20; slope <= 100; slope += 1) {
        for (const rampPadding of [0, 2, 5, 8]) {
          const rampEndTime = minRamp + rampPadding;
          if (rampEndTime > 80) continue;

          const probe = metricsFor({
            ...state,
            adcSamples,
            sampleRate,
            slope,
            rampEndTime,
            idleTime: 10,
            numLoops: 1,
          });
          if (probe.fftRangeSpan < state.rangeGate) continue;
          if (probe.rangeResolution > state.rangeResolutionTarget) continue;

          const centerFreq = probe.centerFreq;
          const maxChirpUs = Math.floor(
            (C / (4 * centerFreq * NUM_TX * state.maxVelocityTarget)) * 1e6
          );
          const minChirpUs = Math.ceil(rampEndTime + 10);
          if (maxChirpUs < minChirpUs) continue;

          const chirpChoices = new Set([
            minChirpUs,
            Math.floor((minChirpUs + maxChirpUs) / 2),
            maxChirpUs - 4,
            maxChirpUs,
          ]);

          for (const chirpUs of chirpChoices) {
            if (chirpUs < minChirpUs || chirpUs > maxChirpUs) continue;
            const idleTime = chirpUs - rampEndTime;
            const numLoops = Math.min(256, Math.floor(budgetUs / (NUM_TX * chirpUs)));
            if (numLoops < 1) continue;

            const params = {
              ...state,
              adcSamples,
              sampleRate,
              slope,
              rampEndTime,
              idleTime,
              numLoops,
            };
            const m = metricsFor(params);
            if (!m.adcFits) continue;
            if (m.duty > state.dutyLimit / 100) continue;
            if (m.maxVelocity < state.maxVelocityTarget) continue;
            if (m.velocityResolution > state.velocityResolutionTarget) continue;
            if (m.rangeResolution > state.rangeResolutionTarget) continue;

            candidates.push({
              params,
              m,
              score: candidateScore(m),
              key: `${adcSamples}-${sampleRate}-${slope}-${rampEndTime}-${idleTime}-${numLoops}`,
            });
          }
        }
      }
    }
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.key);
    if (!existing || candidate.score < existing.score) unique.set(candidate.key, candidate);
  }

  return Array.from(unique.values())
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map((candidate, index) => ({
      ...candidate,
      label: candidateLabel(candidate, index),
    }));
}

function applyCandidate(candidate) {
  Object.assign(state, {
    adcSamples: candidate.params.adcSamples,
    sampleRate: candidate.params.sampleRate,
    slope: candidate.params.slope,
    idleTime: candidate.params.idleTime,
    rampEndTime: candidate.params.rampEndTime,
    numLoops: candidate.params.numLoops,
  });
  syncInputs();
  render();
}

function optimizeVelocity() {
  const [best] = generateCandidates();
  if (best) applyCandidate(best);
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

function syncInputs() {
  els.device.value = state.device;
  els.usePushedMargin.checked = state.usePushedMargin;
  els.priority.value = state.priority;
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

function candidateTable(candidates) {
  if (candidates.length === 0) {
    return `
      <div class="empty-candidates">
        No candidates meet every target. Loosen range resolution, velocity resolution, duty, range, or max speed.
      </div>
    `;
  }

  const rows = candidates.map((candidate, index) => {
    const p = candidate.params;
    const m = candidate.m;
    const active =
      p.adcSamples === state.adcSamples &&
      p.sampleRate === state.sampleRate &&
      p.slope === state.slope &&
      p.idleTime === state.idleTime &&
      p.rampEndTime === state.rampEndTime &&
      p.numLoops === state.numLoops;
    return `
      <tr class="${active ? "selected-candidate" : ""}">
        <td>
          <strong>${candidate.label}</strong>
          <span>${p.adcSamples} ADC, ${fmt(p.sampleRate / 1000, 3)} Msps</span>
        </td>
        <td>${fmt(m.velocityResolution, 4)} m/s</td>
        <td>${fmt(m.rangeResolution, 4)} m</td>
        <td>${fmt(m.maxVelocity, 3)} m/s</td>
        <td>${fmt(m.fftRangeSpan, 2)} m</td>
        <td>${fmt(m.duty * 100, 1)}%</td>
        <td>${fmt(p.slope, 1)} / ${Math.round(p.idleTime)} / ${fmt(p.rampEndTime, 1)} / ${p.numLoops}</td>
        <td><button type="button" data-candidate="${index}">${active ? "Selected" : "Select"}</button></td>
      </tr>
    `;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Candidate</th>
          <th>Vel res</th>
          <th>Range res</th>
          <th>Max vel</th>
          <th>Range span</th>
          <th>Duty</th>
          <th>Slope / idle / ramp / loops</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function render() {
  const m = metrics();
  const candidates = generateCandidates();
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

  document.getElementById("velocityResolution").textContent = `${fmt(m.velocityResolution, 4)} m/s`;
  document.getElementById("maxVelocity").textContent = `${fmt(m.maxVelocity, 3)} m/s`;
  document.getElementById("rangeResolution").textContent = `${fmt(m.rangeResolution, 4)} m`;
  document.getElementById("fftSpan").textContent = `${fmt(m.fftRangeSpan, 2)} m`;
  document.getElementById("activeTime").textContent = `${fmt(m.activeTime * 1000, 2)} ms`;
  document.getElementById("duty").textContent = `${fmt(m.duty * 100, 1)}%`;
  document.getElementById("candidateSummary").textContent =
    candidates.length ? `${candidates.length} viable configs` : "no exact match";
  document.getElementById("candidateTable").innerHTML = candidateTable(candidates);
  document.querySelectorAll("[data-candidate]").forEach((button) => {
    button.addEventListener("click", () => {
      applyCandidate(candidates[Number(button.dataset.candidate)]);
    });
  });

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
  else if (id === "priority") state.priority = target.value;
  else if (id === "usePushedMargin") state.usePushedMargin = target.checked;
  else if (id === "adcSamples") state.adcSamples = Number(target.value);
  else if (id in state) state[id] = Number(target.value);
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

syncInputs();
render();
