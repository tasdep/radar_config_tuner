// A filled cell means one profile meets both plotted targets.
// A bench pass means decoded packets, not measured range or velocity performance.
const BENCH_PACKET_PASSES = [
  { name: "Top speed", frameRateHz: 10, rangeGateM: 20, usableRangeM: 21.01, rangeResolutionM: .410313, maxVelocityMs: 5.66034, velocityResolutionMs: .050539, packets: "41 / 4 s" },
  { name: "Speed", frameRateHz: 10, rangeGateM: 20, usableRangeM: 20.13, rangeResolutionM: .196589, maxVelocityMs: 2.83748, velocityResolutionMs: .050669, packets: "41 / 4 s" },
  { name: "Detail", frameRateHz: 10, rangeGateM: 20, usableRangeM: 20.13, rangeResolutionM: .098295, maxVelocityMs: 1.42463, velocityResolutionMs: .050879, packets: "41 / 4 s" },
  { name: "Finest detail", frameRateHz: 10, rangeGateM: 20, usableRangeM: 20.13, rangeResolutionM: .049147, maxVelocityMs: .71348, velocityResolutionMs: .050963, packets: "101 / 10 s" },
  { name: "Longer range", frameRateHz: 10, rangeGateM: 22, usableRangeM: 22.23, rangeResolutionM: .0543, maxVelocityMs: .713, velocityResolutionMs: .050904, packets: "41 / 4 s" },
];
const BIN_NAMES = { 64: "Top speed", 128: "Speed", 256: "Detail", 512: "Finest detail" };
const svg = document.getElementById("possibilityPlot");
const detail = document.getElementById("plotDetail");
const benchOverlayInput = document.getElementById("benchOverlayInput");
const inputs = {
  frameRateHz: document.getElementById("frameRateInput"),
  requiredRangeM: document.getElementById("rangeInput"),
  velocityResolutionLimitMs: document.getElementById("resolutionInput"),
};
const geometry = { W: 900, H: 500, left: 76, right: 34, top: 20, bottom: 72 };
let selected = { resolutionCm: 10, speedMs: 1 };
let lastModel = null;
let lastBench = [];
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
  if (lastBench.some((row) => row.rangeResolutionM <= capM && row.maxVelocityMs >= speedMs)) {
    return "Exact bench profile passed packet output; target performance is not yet measured.";
  }
  if (lastModel && lastModel.candidates.some((row) =>
    row.rangeResolutionM <= capM && row.maxVelocityMs >= speedMs)) {
    return "SDK model eligible; no exact bench packet pass for this pair.";
  }
  return "No supported profile found by this software search.";
}

function showSelection() {
  const profile = selected.profile ? `${selected.profile} · ` : "";
  detail.textContent = `${profile}Range detail ≤${selected.resolutionCm.toFixed(2)} cm and radial speed ≥±${selected.speedMs.toFixed(3)} m/s: ${statusAt(selected.resolutionCm, selected.speedMs)}`;
}

function drawMap() {
  svg.replaceChildren();
  const { W, H, left, right, top, bottom } = geometry;
  const plotW = W - left - right, plotH = H - top - bottom;
  const all = [...lastModel.candidates, ...lastBench];
  const xMaxCm = Math.max(50, Math.ceil(Math.max(0, ...all.map((r) => r.rangeResolutionM * 100)) * 1.1 / 5) * 5);
  const yMaxMs = Math.max(6, Math.ceil(Math.max(0, ...all.map((r) => r.maxVelocityMs)) * 1.13));
  plotLimits = { xMaxCm, yMaxMs };
  const x = (cm) => left + cm / xMaxCm * plotW;
  const y = (speed) => top + plotH - speed / yMaxMs * plotH;

  svgElement("rect", { x: left, y: top, width: plotW, height: plotH, class: "feasible-empty" });
  const speeds = [...new Set([0, yMaxMs,
    ...lastModel.frontier.map((row) => row.maxVelocityMs),
    ...lastBench.map((row) => row.maxVelocityMs)])]
    .filter((speed) => speed >= 0 && speed <= yMaxMs)
    .sort((a, b) => a - b);
  const modelBands = [];
  const benchBands = [];
  for (let i = 0; i < speeds.length - 1; i++) {
    const speed = (speeds[i] + speeds[i + 1]) / 2;
    const yTop = y(speeds[i + 1]);
    const stripH = y(speeds[i]) - yTop + .5;
    const modelMin = bestResolutionAtSpeed(lastModel.candidates, speed);
    if (Number.isFinite(modelMin)) {
      const begin = x(modelMin * 100);
      modelBands.push({ x: begin, y: yTop, width: Math.max(0, W - right - begin), height: stripH });
    }
    const benchMin = bestResolutionAtSpeed(lastBench, speed);
    if (Number.isFinite(benchMin)) {
      const begin = x(benchMin * 100);
      benchBands.push({ x: begin, y: yTop, width: Math.max(0, W - right - begin), height: stripH });
    }
  }
  for (const band of modelBands) svgElement("rect", { ...band, class: "feasible-model" });
  if (benchOverlayInput.checked) {
    for (const band of benchBands) svgElement("rect", { ...band, class: "feasible-bench" });
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
  for (const row of lastBench) {
    const label = `${row.name}: ${(row.rangeResolutionM * 100).toFixed(1)} cm, ±${row.maxVelocityMs.toFixed(2)} m/s; ${row.packets} packets`;
    snapTargets.push({ resolutionCm: row.rangeResolutionM * 100, speedMs: row.maxVelocityMs,
      profile: `${row.name} bench pass` });
    const point = svgElement("circle", { cx: x(row.rangeResolutionM * 100), cy: y(row.maxVelocityMs), r: 6,
      class: "bench-point", role: "img", tabindex: "0", "aria-label": label });
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
    `<p class="list-note">No software-eligible option for these fixed requirements.</p>`;
  document.getElementById("benchTable").innerHTML = lastBench.length ?
    `<table class="summary-table"><thead><tr><th>Output gate</th><th>Detail</th><th>Max speed</th><th>Packets</th></tr></thead><tbody>${lastBench.map((row) =>
      `<tr><td>${row.rangeGateM.toFixed(1)} m</td><td>${(row.rangeResolutionM * 100).toFixed(1)} cm</td><td>±${row.maxVelocityMs.toFixed(2)}</td><td><span class="status-pill">${row.packets}</span></td></tr>`).join("")}</tbody></table>` :
    `<p class="list-note">No exact bench packet check meets these fixed requirements.</p>`;
}

function render() {
  const requirements = readInputs();
  lastModel = aopPossibilities(requirements);
  lastBench = BENCH_PACKET_PASSES.filter((row) =>
    row.frameRateHz === requirements.frameRateHz &&
    row.rangeGateM >= requirements.requiredRangeM &&
    row.usableRangeM >= requirements.requiredRangeM &&
    row.velocityResolutionMs <= requirements.velocityResolutionLimitMs);
  document.getElementById("emptyMessage").hidden = lastModel.candidates.length > 0;
  drawMap();
  renderTables();
}

for (const input of Object.values(inputs)) input.addEventListener("change", () => {
  selected.profile = null;
  render();
});
benchOverlayInput.addEventListener("change", drawMap);
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
