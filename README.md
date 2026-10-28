# Radar Config Tuner

Small static GUI for tuning TI mmWave SDK 3.x demo configs for the AWR1843AOP
and IWR6843AOP boards.

[Open the hosted Radar Config Tuner](https://tasdep.github.io/radar_config_tuner/).

The tool is intentionally simple:

- velocity-first optimizer for frame rate, range gate, and max radial velocity
- live sliders for chirp/frame/CFAR values
- derived range and Doppler metrics
- expandable chirp/frame graphs with a loop zoom control and ADC timing
- generated `.cfg` text for manual validation in TI mmWave Demo Visualizer
- upload a `.cfg` file to see its derived range, velocity, frame, and detection stats

Use **Upload CFG** to analyze a local TI mmWave SDK 3.x demo config. The
analysis is read-only and runs in the browser; it does not change the tuner
sliders or send the file to a server. It supports 60 GHz and 77 GHz regular
`frameCfg` setups with one chirp per distinct TX antenna in each TDM loop.
Configs using advanced frames, simultaneous TX, or chirp profile variations
show an explicit error instead of an unreliable estimate. Uploaded values are
estimates and should still be checked in TI's tools and on hardware.

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

## Notes

This is not a replacement for TI validation. Use it to explore the coupled
chirp/frame trade space quickly, then load the generated config into TI's tool
and finally onto hardware.

Checker:

- TI mmWave Sensing Estimator 2.5.1: https://dev.ti.com/gallery/view/mmwave/mmWaveSensingEstimator/ver/2.5.1/

The current model assumes:

- SDK 3.x demo config syntax
- 3-TX AOP TDM-MIMO
- `profileCfg` ADC start time fixed at `7 us`
- `chirpCfg 0..2` TX masks `1, 2, 4`
- point output via `guiMonitor -1 1 0 0 0 0 1`
