# Radar Config Tuner

Small static GUI for tuning TI mmWave SDK 3.x demo configs for the AWR1843AOP
and IWR6843AOP boards. The xWR68xx AOP processing-memory model is pinned to
the SDK **03.06.02.00** xWR64xx object-detection demo and its 768 KiB L3 build.

[Open the hosted Radar Config Tuner](https://tasdep.github.io/radar_config_tuner/).

The tool is intentionally simple:

- target solver for frame rate, usable range, velocity and range resolution
- live sliders for chirp/frame/CFAR values
- derived range and Doppler metrics
- expandable chirp/frame graphs with a loop zoom control and ADC timing
- generated `.cfg` text, with the full calculated Doppler FoV
- upload a `.cfg` file to see its derived range, velocity, frame, and detection stats
- offline `check-config.js` CLI with nonzero exit status for modeled violations

Use **Upload CFG** to analyze a local TI mmWave SDK 3.x demo config. The
analysis is read-only and runs in the browser; it does not change the tuner
sliders or send the file to a server. It supports 60 GHz and 77 GHz regular
`frameCfg` setups with one chirp per distinct TX antenna in each TDM loop.
Configs using advanced frames, simultaneous TX, or chirp profile variations
show an explicit error instead of an unreliable estimate. For files marked
`% Platform:xWR68xx_AOP`, the checker also applies the 1–255 frame-loop limit,
the demo's radar-cube and detection-matrix allocations, the 1024-bin range FFT
limit, and the 60–64 GHz chirp sweep boundary. It uses TI's **80% IF** rule for
estimated usable range; this is lower than the full FFT range span. The GUI
solver keeps at least 64 KiB L3 reserve. The manual sliders can reach the
theoretical memory boundary, which may still fail in the running firmware.

These checks are for a regular one-chirp-per-TX TDM frame. They do not prove
RF calibration, packet output, target detection, or sustained operation. The
browser and CLI use the same analysis code. A config without the platform
header gets no AOP-specific memory assertion.

## Run

Open `index.html` directly in a browser, or serve the folder:

```bash
cd radar_config_tuner
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765
```

Check an existing config without a browser:

```bash
node check-config.js path/to/profile.cfg
node check-config.js --json path/to/profile.cfg
node --test config-analysis.test.js
```

Exit status is 0 when no modeled hard limit is exceeded, 1 for a modeled
error, and 2 for an unreadable or unsupported config. Warnings are advisory.

## Notes

The official TI mmWave Sensing Estimator 2.5.1 is useful for RF estimates but
is not an independent startup oracle for this demo. In its public advanced
calculator JavaScript, `get_results_radarCubeSize` receives `numTxAntennas`
but omits it from the multiplication. For the 128-bin, 256-loop, 3-TX,
4-RX AOP config it displays 512 KiB while the SDK demo allocates a 1536 KiB
cube plus a 64 KiB detection matrix. Its validation script also lacks a
255-loop maximum check. The device rejected that config on the bench. This
tool models those two specific missing constraints from the pinned SDK source;
it is not a clone of TI's estimator.

For a 20 m usable-range gate and ≤0.051 m/s nominal Doppler bin spacing on
the tested AOP UART build, 128 samples/112 loops, 256 samples/56 loops, and
512 samples/28 loops each produced 41 valid packets in four seconds. Their
estimated range resolutions are 0.196, 0.098, and 0.049 m respectively;
their maximum unambiguous speeds are about ±2.86, ±1.42, and ±0.71 m/s.
These short tests did not verify a target at 20 m or detection quality.
The 256-bin 59- and 61-loop profiles asserted in EDMA, while 60 loops ran;
the 512-bin 30-loop profile started but produced no valid packets twice.
Those observations are warnings, not universal hardware limits. Use the
64 KiB-reserve solver output as a starting point, then verify the exact image
and config on hardware.

Checker:

- TI mmWave Sensing Estimator 2.5.1: https://dev.ti.com/gallery/view/mmwave/mmWaveSensingEstimator/ver/2.5.1/

The current model assumes:

- SDK 3.x demo config syntax
- 3-TX AOP TDM-MIMO
- `profileCfg` ADC start time fixed at `7 us`
- `chirpCfg 0..2` TX masks `1, 2, 4`
- point output via `guiMonitor -1 1 0 0 0 0 1`
