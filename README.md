# Radar Config Tuner

Small static GUI for tuning TI mmWave SDK 3.x demo configs for the AWR1843AOP
and IWR6843AOP boards. The xWR68xx AOP processing-memory model is pinned to
the SDK **03.06.02.00** xWR64xx object-detection demo and its 768 KiB L3 build.

[Open the hosted Radar Config Tuner](https://tasdep.github.io/radar_config_tuner/).

The [Possibilities view](https://tasdep.github.io/radar_config_tuner/possibilities.html)
samples quantized profiles for the pinned IWR6843AOP demo. Set frame rate,
minimum usable range, and required velocity resolution; the remaining two
axes are maximum allowed range resolution and minimum required maximum radial
speed. A fixed seed drives 20,000 stratified trials across ADC counts, sample
rates, start frequencies, slopes, ramps, even loop counts, and idle times;
the earlier target-directed search supplies additional candidates. The sampled
non-dominated profiles form the feasible envelope. Gray
means no eligible profile was found in that sample; it does not prove
impossibility. Click near a boundary dot to select its exact modeled values,
or click elsewhere to inspect a target pair. The detailed chirp controls
remain in **Advanced tuner**. The current search is specialized for these
three fixed inputs.

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
the demo's radar-cube and detection-matrix allocations, the even-loop HWA
requirement, ADC/ADCBUF limits, RF register quantization, and the 60–64 GHz
chirp sweep boundary. It rejects 1024 range FFT bins with 3 TX and 4 RX:
the SDK documents this mode as unsupported because of an EDMA address jump,
and a 576-sample bench profile lost the CLI despite the demo's 1022-bin
workaround. It uses TI's **80% IF** rule for
estimated usable range; this is lower than the full FFT range span. The GUI
solver and map reject profiles only when the modeled L3 allocations exceed
768 KiB. Profiles near that boundary still need a hardware check.
Requested FoV values are preserved in the generated config even when a status
check flags them; the tool does not silently narrow the user's gate.

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
node check-config.js --max-doppler-resolution 0.051 path/to/profile.cfg
node check-config.js --json path/to/profile.cfg
node sweep-aop.js --json > sweep.json
node --test config-analysis.test.js aop-possibilities.test.js aop-profile-sampler.test.js
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

For a 20 m usable-range gate and ≤0.051 m/s nominal Doppler resolution on
the tested AOP UART build, 128 samples/112 loops with idle time corrected to
122 µs, 256 samples/56 loops, and 512 samples/28 loops each produced 41 valid
packets in four seconds. The original 128/112 profile at 121 µs idle time
also passed packet output but calculates to **0.051021 m/s**, narrowly missing
the hard target. Their
estimated range resolutions are 0.196, 0.098, and 0.049 m respectively;
their maximum unambiguous speeds are about ±2.84, ±1.42, and ±0.71 m/s.
These short tests did not verify a target at 20 m or detection quality.
The 256-bin 59- and 61-loop profiles asserted in EDMA, consistent with the
SDK's even-loop requirement, while 60 loops ran;
the 512-bin 30-loop profile started but produced no valid packets twice.
An experimental 576-sample/14-loop profile entered the unsupported 1024 FFT
mode and stopped the CLI at `sensorStart`. Use the solver output as a starting
point, then verify the exact image and config on hardware.

Checker:

- TI mmWave Sensing Estimator 2.5.1: https://dev.ti.com/gallery/view/mmwave/mmWaveSensingEstimator/ver/2.5.1/

The current model assumes:

- SDK 3.x demo config syntax
- 3-TX AOP TDM-MIMO
- `profileCfg` ADC start time fixed at `7 us`
- `chirpCfg 0..2` TX masks `1, 2, 4`
- point output via `guiMonitor -1 1 0 0 0 0 1`
