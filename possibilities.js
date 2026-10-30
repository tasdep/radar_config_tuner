// A filled cell means one profile meets both plotted targets.
const BIN_NAMES = { 64: "Top speed", 128: "Speed", 256: "Detail", 512: "Finest detail" };
const svg = document.getElementById("possibilityPlot");
const detail = document.getElementById("plotDetail");
const samplePointsInput = document.getElementById("samplePointsInput");
const sampleStats = document.getElementById("sampleStats");
const PROFILE_SAMPLE_COUNT = 20000;
const PROFILE_SAMPLE_SEED = 6843;
const inputs = {
  frameRateHz: document.getElementById("frameRateInput"),
  requiredRangeM: document.getElementById("rangeInput"),
  velocityResolutionLimitMs: document.getElementById("resolutionInput"),
};
const geometry = { W: 900, H: 500, left: 76, right: 34, top: 20, bottom: 72 };
let selected = { resolutionCm: 10, speedMs: 1 };
let lastModel = null;
let plotLimits = { xMaxCm: 50, yMaxMs: 6 };
let snapTargets = [];

function svgElement(name, attrs = {}, value = null) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, text] of Object.entries(attrs)) element.setAttribute(key, text);
  if (value !== null) element.textContent = value;
  svg.appendChild(element);
  return element;
}

function readInputs() {
  const frameRateHz = Math.min(30, Math.max(1, Number(inputs.frameRateHz.value) || 10));
  const requiredRangeM = Math.min(30, Math.max(2, Number(inputs.requiredRangeM.value) || 20));
  const velocityResolutionLimitMs = Math.min(.3, Math.max(.045,
    Number(inputs.velocityResolutionLimitMs.value) || .051));
  inputs.frameRateHz.value = String(frameRateHz);
  inputs.requiredRangeM.value = String(requiredRangeM);
  inputs.velocityResolutionLimitMs.value = velocityResolutionLimitMs.toFixed(3);
  return { frameRateHz, requiredRangeM, velocityResolutionLimitMs };
}

function bestResolutionAtSpeed(items, speedMs) {
  let minimum = Infinity;
  for (const item of items) {
    if (item.maxVelocityMs >= speedMs && item.rangeResolutionM < minimum) minimum = item.rangeResolutionM;
  }
  return minimum;
}

function statusAt(resolutionCm, speedMs) {
  const capM = resolutionCm / 100;
  if (lastModel && lastModel.frontier.some((row) =>
    row.rangeResolutionM <= capM && row.maxVelocityMs >= speedMs)) {
    return "SDK model eligible in the sampled search.";
  }
  return "No eligible profile found in this sample.";
}

function showSelection() {
  const profile = selected.profile ? `${selected.profile} · ` : "";
  detail.textContent = `${profile}Range detail ≤${selected.resolutionCm.toFixed(2)} cm and radial speed ≥±${selected.speedMs.toFixed(3)} m/s: ${statusAt(selected.resolutionCm, selected.speedMs)}`;
}

function drawMap() {
  svg.replaceChildren();
  const { W, H, left, right, top, bottom } = geometry;
  const plotW = W - left - right, plotH = H - top - bottom;
  const all = lastModel.frontier;
  let maxResolutionCm = 0;
  let maxSpeedMs = 0;
  for (const row of all) {
    maxResolutionCm = Math.max(maxResolutionCm, row.rangeResolutionM * 100);
    maxSpeedMs = Math.max(maxSpeedMs, row.maxVelocityMs);
  }
  const xMaxCm = Math.max(50, Math.ceil(maxResolutionCm * 1.1 / 5) * 5);
  const yMaxMs = Math.max(6, Math.ceil(maxSpeedMs * 1.13));
  plotLimits = { xMaxCm, yMaxMs };
  const x = (cm) => left + cm / xMaxCm * plotW;
  const y = (speed) => top + plotH - speed / yMaxMs * plotH;

  svgElement("rect", { x: left, y: top, width: plotW, height: plotH, class: "feasible-empty" });
  const speeds = [...new Set([0, yMaxMs,
    ...lastModel.frontier.map((row) => row.maxVelocityMs)])]
    .filter((speed) => speed >= 0 && speed <= yMaxMs)
    .sort((a, b) => a - b);
  const modelBands = [];
  for (let i = 0; i < speeds.length - 1; i++) {
    const speed = (speeds[i] + speeds[i + 1]) / 2;
    const yTop = y(speeds[i + 1]);
    const stripH = y(speeds[i]) - yTop + .5;
    const modelMin = bestResolutionAtSpeed(lastModel.frontier, speed);
    if (Number.isFinite(modelMin)) {
      const begin = x(modelMin * 100);
      modelBands.push({ x: begin, y: yTop, width: Math.max(0, W - right - begin), height: stripH });
    }
  }
  for (const band of modelBands) svgElement("rect", { ...band, class: "feasible-model" });
  if (samplePointsInput.checked) {
    const visible = lastModel.candidates.filter((row) =>
      row.rangeResolutionM * 100 <= xMaxCm && row.maxVelocityMs <= yMaxMs);
    const stride = Math.max(1, Math.ceil(visible.length / 850));
    for (let i = 0; i < visible.length; i += stride) {
      const row = visible[i];
      svgElement("circle", { cx: x(row.rangeResolutionM * 100), cy: y(row.maxVelocityMs),
        r: 1.7, class: "sample-point" });
    }
  }
  if (lastModel.frontier.length) {
    const frontier = lastModel.frontier;
    let path = `M ${x(frontier[0].rangeResolutionM * 100)} ${y(0)}`;
    for (let i = 0; i < frontier.length; i++) {
      path += ` L ${x(frontier[i].rangeResolutionM * 100)} ${y(frontier[i].maxVelocityMs)}`;
      if (i + 1 < frontier.length) {
        path += ` L ${x(frontier[i + 1].rangeResolutionM * 100)} ${y(frontier[i].maxVelocityMs)}`;
      }
    }
    path += ` L ${W - right} ${y(frontier.at(-1).maxVelocityMs)}`;
    svgElement("path", { d: path, class: "envelope-line" });
  }
  for (let cm = 0; cm <= xMaxCm; cm += xMaxCm > 70 ? 20 : 10) {
    const px = x(cm);
    svgElement("line", { x1: px, x2: px, y1: top, y2: top + plotH, class: "gridline" });
    svgElement("text", { x: px, y: H - bottom + 25, "text-anchor": "middle", class: "axis-text" }, String(cm));
  }
  for (let speed = 0; speed <= yMaxMs; speed += yMaxMs > 10 ? 2 : 1) {
    const py = y(speed);
    svgElement("line", { x1: left, x2: W - right, y1: py, y2: py, class: "gridline" });
    svgElement("text", { x: left - 12, y: py + 4, "text-anchor": "end", class: "axis-text" }, String(speed));
  }
  svgElement("line", { x1: left, x2: W - right, y1: top + plotH, y2: top + plotH, class: "axis" });
  svgElement("line", { x1: left, x2: left, y1: top, y2: top + plotH, class: "axis" });
  svgElement("text", { x: left + plotW / 2, y: H - 14, "text-anchor": "middle", class: "axis-label" }, "Maximum allowed range resolution, cm");
  const yLabel = svgElement("text", { x: 20, y: top + plotH / 2, "text-anchor": "middle", class: "axis-label" }, "Minimum required max radial speed, ±m/s");
  yLabel.setAttribute("transform", `rotate(-90 20 ${top + plotH / 2})`);

  snapTargets = [];
  for (const row of lastModel.frontier) {
    snapTargets.push({ resolutionCm: row.rangeResolutionM * 100, speedMs: row.maxVelocityMs,
      profile: "Sampled envelope point" });
    svgElement("circle", { cx: x(row.rangeResolutionM * 100), cy: y(row.maxVelocityMs),
      r: 2.8, class: "envelope-point" });
  }
  for (const row of lastModel.summaries) {
    const label = `${BIN_NAMES[row.fftBins]} modeled option: ${(row.rangeResolutionM * 100).toFixed(1)} cm, ±${row.maxVelocityMs.toFixed(2)} m/s`;
    snapTargets.push({ resolutionCm: row.rangeResolutionM * 100, speedMs: row.maxVelocityMs,
      profile: `${BIN_NAMES[row.fftBins]} modeled option` });
    const point = svgElement("circle", { cx: x(row.rangeResolutionM * 100), cy: y(row.maxVelocityMs), r: 6,
      class: "model-point", role: "img", tabindex: "0", "aria-label": label });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = label;
    point.appendChild(title);
  }
  selected.resolutionCm = Math.min(selected.resolutionCm, xMaxCm);
  selected.speedMs = Math.min(selected.speedMs, yMaxMs);
  svgElement("line", { x1: x(selected.resolutionCm), x2: x(selected.resolutionCm), y1: top, y2: top + plotH, class: "selection-line" });
  svgElement("line", { x1: left, x2: W - right, y1: y(selected.speedMs), y2: y(selected.speedMs), class: "selection-line" });
  svgElement("circle", { cx: x(selected.resolutionCm), cy: y(selected.speedMs), r: 6, class: "selection-point" });
  showSelection();
}

function renderTables() {
  const summaries = lastModel.summaries.slice().sort((a, b) => b.maxVelocityMs - a.maxVelocityMs);
  document.getElementById("envelopeTable").innerHTML = summaries.length ?
    `<table class="summary-table"><thead><tr><th>Option</th><th>Range detail</th><th>Max speed</th></tr></thead><tbody>${summaries.map((row) =>
      `<tr><td>${BIN_NAMES[row.fftBins]}</td><td>${(row.rangeResolutionM * 100).toFixed(1)} cm</td><td>±${row.maxVelocityMs.toFixed(2)} m/s</td></tr>`).join("")}</tbody></table>` :
    `<p class="list-note">No eligible option found in this sample.</p>`;
}

function render() {
  const requirements = readInputs();
  lastModel = aopSampleProfiles({ ...requirements,
    sampleCount: PROFILE_SAMPLE_COUNT, seed: PROFILE_SAMPLE_SEED });
  document.getElementById("emptyMessage").hidden = lastModel.candidates.length > 0;
  sampleStats.textContent = `${lastModel.stats.sampledTrials.toLocaleString()} seeded trials + ${lastModel.stats.anchorProfiles.toLocaleString()} target-directed profiles · ${lastModel.candidates.length.toLocaleString()} eligible · ${lastModel.frontier.length.toLocaleString()} envelope points · seed ${lastModel.stats.seed}`;
  drawMap();
  renderTables();
}

for (const input of Object.values(inputs)) input.addEventListener("change", () => {
  selected.profile = null;
  render();
});
samplePointsInput.addEventListener("change", drawMap);
svg.addEventListener("click", (event) => {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(svg.getScreenCTM().inverse());
  const { W, H, left, right, top, bottom } = geometry;
  if (local.x < left || local.x > W - right || local.y < top || local.y > H - bottom) return;
  const x = (cm) => left + cm / plotLimits.xMaxCm * (W - left - right);
  const y = (speed) => H - bottom - speed / plotLimits.yMaxMs * (H - top - bottom);
  const screen = svg.getScreenCTM();
  const toScreen = (px, py) => {
    const point = svg.createSVGPoint();
    point.x = px;
    point.y = py;
    return point.matrixTransform(screen);
  };
  let nearest = null;
  let nearestDistance = 18;
  for (const target of snapTargets) {
    const at = toScreen(x(target.resolutionCm), y(target.speedMs));
    const distance = Math.hypot(at.x - event.clientX, at.y - event.clientY);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  selected = nearest ? { ...nearest } : {
    resolutionCm: (local.x - left) / (W - left - right) * plotLimits.xMaxCm,
    speedMs: (H - bottom - local.y) / (H - top - bottom) * plotLimits.yMaxMs,
  };
  drawMap();
});
render();
