# Radar Config Tuner

Small static GUI for tuning TI mmWave SDK 3.x demo configs for the AWR1843AOP
and IWR6843AOP boards.

The tool is intentionally simple:

- velocity-first optimizer for frame rate, range gate, and max radial velocity
- live sliders for chirp/frame/CFAR values
- derived range and Doppler metrics
- generated `.cfg` text for manual validation in TI mmWave Demo Visualizer

## Run

Open `index.html` directly in a browser, or serve the folder:

```bash
cd /home/tas/thesis/radar_config_tuner
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

The current model assumes:

- SDK 3.x demo config syntax
- 3-TX AOP TDM-MIMO
- `profileCfg` ADC start time fixed at `7 us`
- `chirpCfg 0..2` TX masks `1, 2, 4`
- point output via `guiMonitor -1 1 0 0 0 0 1`
