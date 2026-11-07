# PM 101-question interview — Q79 custom decision (2026-11-02)

**Append-only conflict-safe decision record.** Do not overwrite canonical reports/pm/qa-101-progress-2026-11-01.md or earlier audited Q50–Q78 records.

## Q79 = C + explicit custom scope "try via Bluetooth"; NO IR
Original task T-feaf702f, PM comment **#1209**.
User clarified "C try via Bluetooth", "Phone app has to use Bluetooth or WiFi", and "There's no ir." Treat this as the user's custom Bluetooth-first research/testing direction, **not** the earlier C language assigning CheaperInference and NOT a new paid-seat or live-call authorization. Do not propose a hardware IR emitter, require IR, buy an IR bridge, or imply the Pixel has one.

### Verified documentation
- Current VIZIO Mobile app uses **Bluetooth** for phone pairing and soundbar audio adjustments including bass and treble on supported newer models: https://www.vizio.com/en/mobile/control
- VIZIO publicly stated the older **V51-H6 cannot be controlled with SmartCast mobile app**: https://www.bestbuy.com/site/questions/vizio-5-1-channel-v-series-soundbar-with-wireless-subwoofer-and-dolby-audio-5-1-dts-virtualx-black/6416784?page=22
- Official V51-H6 manual documents Bluetooth music-streaming pairing, HDMI ARC, AUX, optical and USB; does not document Wi-Fi or remote EQ/Night Mode commands over Bluetooth: https://cdn.vizio.com/user-manual/PDF/2020/SB/UM/V51-H6_UM-ENG.pdf
- Home Assistant built-in Bluetooth integration supports BLE; it does **not** itself support Bluetooth Classic devices: https://www.home-assistant.io/integrations/bluetooth/
- HDMI-CEC volume/mute is a separate partial fallback, not proof of bass/treble/EQ/Night Mode.

### Approved investigation
Free/local-first agents, **without paid model fallback**, should examine read-only owner-authorized current Bluetooth connection/device descriptors, V51-H6 firmware and exposed Bluetooth Classic profiles/SDP, possible BLE GATT discovery, old VIZIO app model support, and reliable evidence of any vendor-specific control protocol. Distinguish controlling source audio/volume from changing soundbar hardware EQ/Night Mode. Document feasibility table and exactly which protocol is proven, plausible or unsupported; report command-level PASS/FAIL/UNTESTED and minimum safe next step. If a genuine path exists, seek separate scoped user permission for pairing, control commands or any live disruptive test; do not infer user automatically approved resetting currently paired sources.

Keep prior parked standalone prototype intact, no IR hardware, no purchase, no destructive pairing/reset, no code or device change, no Home Assistant service restart, no TV integration, no merged code or deployment without separate user approval. Do not call an attempted Bluetooth audio connection successful hardware EQ control.

### Interview preservation
All PM Q1–Q78 preserved; Q61 **UNANSWERED** pending 3 dashboard screenshots on original T-ff91600e. Grouped Q78=D PM comments 1205/1206/1207 conditional archival only. Q77 original LinkedIn scratchpad not byte-verified (bridge result only, #1204), Q71 Ecom Opus lane T-fea51534 blocked after headless permissions (#1199). Original task IDs, source history, historical LinkedIn Q1–Q35 and Event Manager E1–E15/F1–F29 retained.

## Next distinct Q80 candidate
Original task T-7cfeaefa Solar Monitor V1 parent previously resolved GROUPED Q32=B use existing green-energy-platform repository, and Q33=A child-specific specs-first. Reasking repo choice would DUPLICATE prior answer. Prefer a truly distinct PM blocker not already covered by Q1–Q79, e.g. orphaned current hardware/permission validation of a new task if grounded; inspect PM history before presenting.
