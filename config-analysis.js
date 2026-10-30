// Read-only analysis of SDK 3.x frame configs with one TDM chirp per TX.
const aopLimits = typeof module !== "undefined" ?
  require("./sdk36-aop-limits.js") : aopSdk36Limits;
const CONFIG_SPEED_OF_LIGHT = 3e8; // mmwdemo_rfparser.c:96

function analyzeConfig(text) {
  const commands = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(/[%#]/, 1)[0].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const name = parts.shift();
    if (!commands.has(name)) commands.set(name, []);
    commands.get(name).push(parts);
  }

  const rows = (name) => commands.get(name) || [];
  const number = (value, label, { min = -Infinity, integer = false } = {}) => {
    const n = Number(value);
    if (value === undefined || !Number.isFinite(n) || n <= min || (integer && !Number.isInteger(n))) {
      throw new Error(`Invalid or missing ${label}.`);
    }
    return n;
  };
  const one = (name) => {
    if (rows(name).length !== 1) throw new Error(`Expected one ${name} command; found ${rows(name).length}.`);
    return rows(name)[0];
  };

  const frame = one("frameCfg");
  const startChirp = number(frame[0], "frameCfg start chirp", { min: -1, integer: true });
  const endChirp = number(frame[1], "frameCfg end chirp", { min: -1, integer: true });
  if (endChirp < startChirp || endChirp - startChirp > 255) {
    throw new Error("frameCfg chirp range is invalid or too large.");
  }
  const loops = number(frame[2], "frameCfg loops", { min: 0, integer: true });
  const frameMs = number(frame[4], "frameCfg frame period", { min: 0 });
  const chirpDefinitions = rows("chirpCfg");
  if (!chirpDefinitions.length) throw new Error("No chirpCfg commands found.");
  const sequence = [];
  for (let chirp = startChirp; chirp <= endChirp; chirp++) {
    const matches = chirpDefinitions.filter((row) => {
      const first = number(row[0], "chirpCfg start index", { min: -1, integer: true });
      const last = number(row[1], "chirpCfg end index", { min: -1, integer: true });
      return first <= chirp && chirp <= last;
    });
    if (matches.length !== 1) throw new Error(`Frame chirp ${chirp} must have exactly one chirpCfg definition.`);
    const row = matches[0];
    const profileId = number(row[2], "chirpCfg profile ID", { min: -1, integer: true });
    const txMask = number(row[7], "chirpCfg TX mask", { min: 0, integer: true });
    if ((txMask & (txMask - 1)) !== 0) {
      throw new Error("Analysis supports one TX antenna per chirp (TDM-MIMO). Multiple simultaneous TX antennas were found.");
    }
    if (row.slice(3, 7).some((v) => Number(v) !== 0)) {
      throw new Error("Analysis does not support chirpCfg profile variations (start frequency, slope, idle time, or ADC start time).");
    }
    sequence.push({ profileId, txMask });
  }
  if (new Set(sequence.map((item) => item.profileId)).size !== 1 ||
      new Set(sequence.map((item) => item.txMask)).size !== sequence.length) {
    throw new Error("Analysis requires one profile and one chirp per distinct TX antenna in each loop.");
  }

  const matchingProfiles = rows("profileCfg").filter((row) => Number(row[0]) === sequence[0].profileId);
  if (matchingProfiles.length !== 1) throw new Error(`Expected one profileCfg for profile ${sequence[0].profileId}.`);
  const profile = matchingProfiles[0];
  const startGHz = number(profile[1], "profileCfg start frequency", { min: 0 });
  if (!((startGHz >= 57 && startGHz <= 64) || (startGHz >= 76 && startGHz <= 81))) {
    throw new Error("Only 60 GHz and 77 GHz TI mmWave profiles are supported.");
  }
  const idleUs = number(profile[2], "profileCfg idle time", { min: -1 });
  const adcStartUs = number(profile[3], "profileCfg ADC start time", { min: -1 });
  const rampUs = number(profile[4], "profileCfg ramp end time", { min: 0 });
  const slopeMHzUs = number(profile[7], "profileCfg frequency slope", { min: 0 });
  const samples = number(profile[9], "profileCfg ADC samples", { min: 0, integer: true });
  const sampleRateKsps = number(profile[10], "profileCfg sample rate", { min: 0 });
  const hpf2Code = number(profile[12], "profileCfg HPF2 code", { min: -1, integer: true });
  const hpf2Hz = [350000, 700000, 1400000, 2800000][hpf2Code];
  const txCount = sequence.length;
  let rangeBins = 2 ** Math.ceil(Math.log2(samples));
  let fftRangeBins = rangeBins;
  const adcSeconds = samples / (sampleRateKsps * 1000);
  let slopeHzS = slopeMHzUs * 1e12;
  let bandwidthHz = slopeHzS * adcSeconds;
  let chirpSeconds = (idleUs + rampUs) * 1e-6;
  let centerHz = startGHz * 1e9 + slopeHzS * (adcStartUs * 1e-6 + adcSeconds / 2);
  const chirpsPerFrame = txCount * loops;
  let activeMs = chirpsPerFrame * chirpSeconds * 1000;
  let rangeResolutionM = CONFIG_SPEED_OF_LIGHT / (2 * bandwidthHz);
  let rangeBinM = CONFIG_SPEED_OF_LIGHT * sampleRateKsps * 1000 / (2 * slopeHzS * rangeBins);
  let fftRangeSpanM = rangeBinM * rangeBins;
  let lastRangeBinM = rangeBinM * (rangeBins - 1);
  const usableBeatHz = Math.min(sampleRateKsps * 1000 * 0.8, 10e6);
  let usableRangeM = CONFIG_SPEED_OF_LIGHT * usableBeatHz / (2 * slopeHzS);
  let endGHz = startGHz + slopeMHzUs * rampUs / 1000;
  let maxVelocityMs = CONFIG_SPEED_OF_LIGHT / (4 * centerHz * chirpSeconds * txCount);
  let velocityResolutionMs = CONFIG_SPEED_OF_LIGHT / (2 * centerHz * chirpSeconds * chirpsPerFrame);
  let dopplerStepMs = CONFIG_SPEED_OF_LIGHT /
    (2 * 2 ** Math.ceil(Math.log2(loops)) * centerHz * chirpSeconds * txCount);
  let hpf2CornerRangeM = hpf2Hz ? CONFIG_SPEED_OF_LIGHT * hpf2Hz / (2 * slopeHzS) : null;
  const platform = text.match(/^%\s*Platform\s*:\s*(\S+)/m)?.[1];
  const isSdk36Aop = platform === "xWR68xx_AOP";
  const errors = [];
  let l3 = null;
  let quantizedProfile = null;
  if (loops > aopLimits.AOP_SDK36_LIMITS.maxFrameLoops) {
    errors.push(`frameCfg loops ${loops} exceeds mmWaveLink's 1–255 limit.`);
  }
  if (isSdk36Aop) {
    if (sequence.length > 32) errors.push("SDK 3.6 AOP RF parser supports at most 32 unique frame chirps.");
    if (loops % 2) errors.push("SDK 3.6 AOP range HWA requires an even number of Doppler loops for ping/pong processing.");
    if (samples < 64 || samples > 1024) errors.push("SDK 3.6 AOP range HWA requires 64–1024 ADC samples.");
    if (sampleRateKsps < 2000 || sampleRateKsps > 12500) {
      errors.push("xWR6843 complex-1x ADC sample rate must be 2000–12500 ksps.");
    }
    const adc = one("adcCfg");
    if (Number(adc[0]) !== 2 || Number(adc[1]) !== 1) {
      errors.push("SDK 3.6 AOP range HWA requires 16-bit complex ADC output (adcCfg 2 1).");
    }
    const adcbuf = one("adcbufCfg");
    if (Number(adcbuf[1]) !== 0 || Number(adcbuf[2]) !== 1 || Number(adcbuf[4]) !== 1) {
      errors.push("SDK 3.6 AOP requires complex IMRE ADC buffer and chirp threshold 1 (adcbufCfg -1 0 1 ... 1).");
    }
    const channel = one("channelCfg");
    const rxMask = number(channel[0], "channelCfg RX mask", { min: 0, integer: true });
    const txMask = number(channel[1], "channelCfg TX mask", { min: 0, integer: true });
    const rxCount = rxMask.toString(2).replace(/0/g, "").length;
    if (rxMask > 15 || ![1, 2, 4].includes(rxCount)) errors.push("AOP range HWA supports 1, 2, or 4 RX channels.");
    if (txMask > 7 || sequence.some((item) => !(item.txMask & txMask))) {
      errors.push("AOP chirpCfg uses a TX channel not enabled by channelCfg.");
    }
    quantizedProfile = aopLimits.aopQuantizedProfile({
      startGHz, idleUs, adcStartUs, rampUs, slopeMHzUs,
      adcSamples: samples, sampleRateKsps, loops, txCount, rxCount,
    });
    l3 = quantizedProfile.l3;
    if (l3.fftRangeBins === 1024 && txCount === 3 && rxCount === 4) {
      errors.push("SDK 3.6 range HWA documents a 1024-bin 3 TX × 4 RX radar cube as unsupported (EDMA address jump). The demo reduces it to 1022 processed bins, but that path lost CLI on the tested AOP UART image at 576 samples/14 loops; treat this FFT mode as unvalidated for this image.");
    }
    fftRangeBins = l3.fftRangeBins;
    rangeBins = l3.rangeBins;
    slopeHzS = quantizedProfile.actualSlopeMHzUs * 1e12;
    bandwidthHz = slopeHzS * adcSeconds;
    chirpSeconds = quantizedProfile.chirpSeconds;
    centerHz = quantizedProfile.centerHz;
    activeMs = chirpsPerFrame * chirpSeconds * 1000;
    rangeResolutionM = quantizedProfile.rangeResolutionM;
    rangeBinM = quantizedProfile.rangeStepM;
    fftRangeSpanM = quantizedProfile.fftRangeSpanM;
    lastRangeBinM = quantizedProfile.lastRangeBinM;
    usableRangeM = quantizedProfile.usableRangeM;
    endGHz = quantizedProfile.endGHz;
    maxVelocityMs = quantizedProfile.maxVelocityMs;
    velocityResolutionMs = quantizedProfile.dopplerResolutionMs;
    dopplerStepMs = quantizedProfile.dopplerStepMs;
    hpf2CornerRangeM = hpf2Hz ? CONFIG_SPEED_OF_LIGHT * hpf2Hz / (2 * slopeHzS) : null;
    if (hpf2Hz === undefined) errors.push("profileCfg HPF2 code must be 0–3.");
    // A nominal 60.000 GHz CLI start truncates by one 40 Hz register LSB.
    const bandToleranceGHz = 1e-6;
    const inLowBand = quantizedProfile.actualStartGHz >= 57 - bandToleranceGHz &&
      endGHz <= 60.75 + bandToleranceGHz;
    const inHighBand = quantizedProfile.actualStartGHz >= 60 - bandToleranceGHz &&
      endGHz <= 64 + bandToleranceGHz;
    if (!inLowBand && !inHighBand) {
      errors.push(`Quantized chirp sweep ${quantizedProfile.actualStartGHz.toFixed(3)}–${endGHz.toFixed(3)} GHz is outside one permitted 60 GHz VCO band.`);
    }
    if (quantizedProfile.startRegister % 2) errors.push("60 GHz start-frequency register must be even.");
    if (quantizedProfile.slopeRegister <= 0) errors.push("Quantized profile slope is zero or negative.");
    if (adcStartUs + adcSeconds * 1e6 > rampUs) errors.push("ADC capture extends beyond the ramp end time.");
    if (frameMs - activeMs < 0.3) errors.push("Frame needs at least 300 µs interframe blanking after chirps.");
    if (rxCount * Math.ceil(samples * 4 / 16) * 16 > aopLimits.AOP_SDK36_LIMITS.adcBufBytes) {
      errors.push("One chirp of complex RX samples exceeds the 32 KiB ADC buffer.");
    }
    if (l3.freeBytes < 0) {
      errors.push(`SDK 3.6 AOP L3 needs ${(l3.usedBytes / 1024).toFixed(1)} KiB (cube + detection matrix); only 768 KiB is available.`);
    }
  }

  const fov = {};
  for (const row of rows("cfarFovCfg")) {
    const type = Number(row[1]);
    if (type === 0 || type === 1) {
      const low = Number(row[2]);
      const high = Number(row[3]);
      if (Number.isFinite(low) && Number.isFinite(high)) fov[type] = [low, high];
    }
  }
  const thresholds = {};
  for (const row of rows("cfarCfg")) {
    const type = Number(row[1]);
    const threshold = Number(row[7]);
    if ((type === 0 || type === 1) && Number.isFinite(threshold)) thresholds[type] = threshold;
  }
  const warnings = [];
  if (!isSdk36Aop) warnings.push("Firmware-specific processing-memory check not available for this platform.");
  if (isSdk36Aop && rangeBins === 512 && loops === 30) {
    warnings.push("Bench observation: one 512-bin/30-loop AOP UART profile started but yielded no valid packets; this is not a proven general hardware limit.");
  }
  if (adcStartUs + adcSeconds * 1e6 > rampUs) warnings.push("ADC capture extends beyond the ramp end time.");
  if (activeMs > frameMs) warnings.push("Active chirps exceed the configured frame period.");
  if (fov[0] && (fov[0][0] < 0 || fov[0][1] > lastRangeBinM)) {
    warnings.push("Range FoV extends beyond the final processed range-bin center.");
  }
  if (isSdk36Aop && fov[0] && fov[0][1] > usableRangeM) {
    warnings.push(`Range FoV extends beyond TI's 80% IF usable-range estimate (${usableRangeM.toFixed(2)} m).`);
  }
  if (fov[1] && Math.max(Math.abs(fov[1][0]), Math.abs(fov[1][1])) > maxVelocityMs) {
    warnings.push("Doppler FoV extends beyond the calculated maximum radial velocity.");
  }
  return {
    profileId: sequence[0].profileId, startGHz, idleUs, adcStartUs, rampUs,
    slopeMHzUs, samples, sampleRateKsps, txCount, loops, frameMs, chirpsPerFrame,
    adcUs: adcSeconds * 1e6, bandwidthMHz: bandwidthHz / 1e6,
    centerGHz: centerHz / 1e9, rangeBins, fftRangeBins, rangeResolutionM,
    rangeBinM, rangeSpanM: fftRangeSpanM, lastRangeBinM, usableRangeM, endGHz,
    maxVelocityMs, velocityResolutionMs, dopplerStepMs, hpf2Code,
    hpf2CornerRangeM, activeMs,
    dutyPercent: activeMs / frameMs * 100, frameRateHz: 1000 / frameMs,
    platform, fov, thresholds, l3, quantizedProfile, errors, warnings,
  };
}

if (typeof module !== "undefined") module.exports = { analyzeConfig };

if (typeof document !== "undefined") {
  const upload = document.getElementById("uploadConfig");
  const panel = document.getElementById("uploadedPanel");
  const message = document.getElementById("uploadMessage");
  const metricGrid = document.getElementById("uploadedMetrics");
  const explainer = document.getElementById("uploadedExplainer");
  const warningBox = document.getElementById("uploadedWarnings");
  const fixed = (n, digits = 2) => n.toFixed(digits);
  const addText = (parent, tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    parent.appendChild(element);
    return element;
  };
  const addSection = (title, items) => {
    const section = document.createElement("div");
    section.className = "explainer-section";
    addText(section, "h3", title);
    for (const [label, value] of items) {
      const item = document.createElement("div");
      item.className = "explainer-item";
      addText(item, "span", label);
      addText(item, "strong", value);
      section.appendChild(item);
    }
    explainer.appendChild(section);
  };
  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    panel.hidden = false;
    document.getElementById("uploadedName").textContent = file.name;
    metricGrid.replaceChildren();
    explainer.replaceChildren();
    warningBox.replaceChildren();
    try {
      if (file.size > 1024 * 1024) throw new Error("Config file exceeds 1 MB.");
      const data = analyzeConfig(await file.text());
      message.textContent = "Calculated from the uploaded commands. Values are estimates for a regular TDM frame.";
      const cards = [
        ["Range resolution", `${fixed(data.rangeResolutionM, 4)} m`, "Smallest estimated range separation from ADC bandwidth."],
        ["FFT range span", `${fixed(data.rangeSpanM)} m`, "Calculated span before any range FoV gate."],
        ["Estimated usable range", `${fixed(data.usableRangeM)} m`, "TI's 80% ADC IF visibility model for complex 6843/1843 chirps."],
        ["Maximum radial velocity", `${fixed(data.maxVelocityMs, 3)} m/s`, "Estimated unambiguous radial speed."],
        ["Nominal Doppler resolution", `${fixed(data.velocityResolutionMs, 6)} m/s`, "SDK parser scale from the actual chirp count."],
        ["Doppler FFT bin step", `${fixed(data.dopplerStepMs, 6)} m/s`, "Point-cloud velocity-bin spacing after FFT padding."],
        ["Frame rate", `${fixed(data.frameRateHz, 2)} Hz`, "Frames produced per second from frameCfg."],
        ["Active chirp duty", `${fixed(data.dutyPercent, 1)}%`, "Time spent on configured chirps within each frame."],
      ];
      if (data.l3) cards.push([
        "SDK 3.6 AOP L3", `${fixed(data.l3.usedBytes / 1024, 1)} / 768 KiB`,
        "Radar cube plus Doppler detection matrix; firmware-specific estimate.",
      ]);
      for (const [label, value, description] of cards) {
        const card = document.createElement("article");
        card.className = "metric";
        addText(card, "span", label);
        addText(card, "strong", value);
        addText(card, "small", description);
        metricGrid.appendChild(card);
      }
      addSection("Profile and ADC", [
        ["Profile ID", `${data.profileId}`],
        ["Start / center frequency", `${fixed(data.startGHz, 3)} / ${fixed(data.centerGHz, 4)} GHz`],
        ["Idle / ramp time", `${fixed(data.idleUs)} / ${fixed(data.rampUs)} us`],
        ["ADC start / capture time", `${fixed(data.adcStartUs)} / ${fixed(data.adcUs)} us`],
        ["Slope / bandwidth", `${fixed(data.slopeMHzUs, 2)} MHz/us / ${fixed(data.bandwidthMHz, 1)} MHz`],
        ["Samples / sample rate", `${data.samples} / ${fixed(data.sampleRateKsps)} ksps`],
        ["HPF2 corner equivalent", data.hpf2CornerRangeM === null ? "Unknown" :
          `${fixed(data.hpf2CornerRangeM, 2)} m (analog attenuation, not a cutoff)`],
      ]);
      addSection("Frame and derived stats", [
        ["TX antennas / loops", `${data.txCount} / ${data.loops}`],
        ["Chirps per frame", `${data.chirpsPerFrame}`],
        ["Frame / active time", `${fixed(data.frameMs, 3)} / ${fixed(data.activeMs, 3)} ms`],
        ["Range bins / bin spacing", `${data.rangeBins} / ${fixed(data.rangeBinM, 4)} m`],
      ]);
      addSection("Detection settings", [
        ["Range FoV", data.fov[0] ? `${data.fov[0][0]} to ${data.fov[0][1]} m` : "Not specified"],
        ["Doppler FoV", data.fov[1] ? `${data.fov[1][0]} to ${data.fov[1][1]} m/s` : "Not specified"],
        ["Range CFAR threshold", data.thresholds[0] === undefined ? "Not specified" : `${data.thresholds[0]} dB`],
        ["Doppler CFAR threshold", data.thresholds[1] === undefined ? "Not specified" : `${data.thresholds[1]} dB`],
      ]);
      for (const error of data.errors) addText(warningBox, "p", error).className = "upload-error";
      for (const warning of data.warnings) addText(warningBox, "p", warning);
    } catch (error) {
      message.textContent = `Could not analyze ${file.name}: ${error.message}`;
    }
    upload.value = "";
  });
}
