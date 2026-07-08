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
  "frameRate",
  "rangeGate",
  "maxVelocityTarget",
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

function metrics() {
  const device = currentDevice();
  const sampleRateHz = state.sampleRate * 1000;
  const slopeHzPerS = state.slope * 1e12;
  const adcSamples = state.adcSamples;
  const numRangeBins = nextPowerOfTwo(adcSamples);
  const adcTime = adcSamples / sampleRateHz;
  const bandwidth = slopeHzPerS * adcTime;
  const rangeResolution = C / (2 * bandwidth);
  const rangeStep = C * sampleRateHz / (2 * slopeHzPerS * numRangeBins);
  const fftRangeSpan = rangeStep * numRangeBins;
  const chirpPeriod = (state.idleTime + state.rampEndTime) * 1e-6;
  const framePeriod = 1 / state.frameRate;
  const activeTime = NUM_TX * state.numLoops * chirpPeriod;
  const duty = activeTime / framePeriod;
  const centerFreq =
    device.startFreqGHz * 1e9 +
    slopeHzPerS * (7e-6 + adcTime / 2);
  const maxVelocity = C / (4 * centerFreq * chirpPeriod * NUM_TX);
  const velocityResolution =
    C / (2 * centerFreq * chirpPeriod * NUM_TX * state.numLoops);
  const chirpsPerFrame = NUM_TX * state.numLoops;

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
  };
}

function optimizeVelocity() {
  const device = currentDevice();
  const sampleRateHz = state.sampleRate * 1000;
  const adcTime = state.adcSamples / sampleRateHz;

  const chirpForMaxVelocity =
    C / (4 * device.startFreqGHz * 1e9 * NUM_TX * state.maxVelocityTarget);
  const minimumRamp = Math.max(10, Math.ceil((adcTime + 7e-6) * 1e6 + 1));
  const ramp = Math.max(minimumRamp, Math.min(35, Math.round(state.rampEndTime)));
  const desiredChirpUs = Math.floor(chirpForMaxVelocity * 1e6);
  const idle = Math.max(10, desiredChirpUs - ramp);
  state.rampEndTime = ramp;
  state.idleTime = idle;

  const chirpPeriod = (state.idleTime + state.rampEndTime) * 1e-6;
  const framePeriod = 1 / state.frameRate;
  const dutyBudget = state.usePushedMargin
    ? Math.min(state.dutyLimit + 2, 55)
    : state.dutyLimit;
  const maxLoops = Math.floor((framePeriod * dutyBudget / 100) / (NUM_TX * chirpPeriod));
  state.numLoops = Math.max(1, Math.min(256, maxLoops));

  const numRangeBins = nextPowerOfTwo(state.adcSamples);
  const maxSlopeForRange =
    (C * sampleRateHz) / (2 * numRangeBins * state.rangeGate) / 1e12;
  const margin = state.usePushedMargin ? 0.98 : 0.78;
  state.slope = Math.max(10, Math.min(120, Math.floor(maxSlopeForRange * margin * 10) / 10));

  syncInputs();
  render();
}

function statusItems(m) {
  const items = [];
  const dutyLimit = state.dutyLimit / 100;
  const rangeOk = m.fftRangeSpan >= state.rangeGate;
  const velocityOk = m.maxVelocity >= state.maxVelocityTarget;
  const dutyOk = m.duty <= dutyLimit;
  const adcFits = m.adcTime * 1e6 + 7 <= state.rampEndTime;

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

function syncInputs() {
  els.device.value = state.device;
  els.usePushedMargin.checked = state.usePushedMargin;
  els.frameRate.value = state.frameRate;
  els.rangeGate.value = state.rangeGate;
  els.maxVelocityTarget.value = state.maxVelocityTarget;
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
  const m = metrics();
  document.getElementById("frameRateOut").value = `${state.frameRate} Hz`;
  document.getElementById("rangeGateOut").value = `${fmt(state.rangeGate, 1)} m`;
  document.getElementById("maxVelocityTargetOut").value = `${fmt(state.maxVelocityTarget, 2)} m/s`;
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

  const status = statusItems(m);
  document.getElementById("statusList").innerHTML = status
    .map((item) => `<div class="status-item status-${item.level}"><span>${item.label}</span><strong>${item.value}</strong></div>`)
    .join("");

  const cfg = generateConfig(m);
  document.getElementById("configName").textContent = cfg.name;
  document.getElementById("configText").value = cfg.text;
}

function updateStateFromInput(event) {
  const target = event.target;
  const id = target.id;
  if (id === "device") state.device = target.value;
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
