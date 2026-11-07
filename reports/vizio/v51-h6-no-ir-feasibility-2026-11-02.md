# VIZIO V51-H6 — IR-free Home Assistant feasibility review (2026-11-02)

**Purpose:** Owner challenged prior assumption that an IR bridge is mandatory simply because modern phones lack IR emitters. Original PM task T-feaf702f; comment #1208. This is a public-documentation-only assessment and source-preserving research handoff; NO physical device test or Q79 option selection, no modification of parked prototype.

## Source-grounded facts
1. Home Assistant VIZIO SmartCast integration supports compatible network-connected SmartCast soundbars. It requires a device network address. Reference: https://www.home-assistant.io/integrations/vizio/
2. VIZIO explicitly answered that V51-H6 cannot be controlled by SmartCast mobile app. Reference: https://www.bestbuy.com/site/questions/vizio-5-1-channel-v-series-soundbar-with-wireless-subwoofer-and-dolby-audio-5-1-dts-virtualx-black/6416784?page=22 . The official V51-H6 manual lists HDMI ARC, Bluetooth, optical, AUX and USB sound files but no Wi-Fi/Ethernet/SmartCast interface. Reference: https://cdn.vizio.com/user-manual/PDF/2020/SB/UM/V51-H6_UM-ENG.pdf (connections and specs). Independent RTINGS review states V51-H6 has no Wi-Fi/Chromecast: https://www.rtings.com/soundbar/reviews/vizio/v-series-v51-h6
3. V51-H6 Bluetooth is documented for audio/voice assistant pairing, not EQ/Night command control. Do NOT infer a supported BLE GATT/proprietary control path from Bluetooth presence alone. Original remote provides EQ, bass, treble, Effect > Night. No trustworthy V51-H6 proprietary non-IR control protocol verified.
4. V51-H6 HDMI ARC/CEC supports system-audio volume via TV (official manual page 31). Home Assistant HDMI-CEC can issue power, volume/mute and raw CEC, but hardware adapter and CEC topology matter. No documented V51-H6 CEC EQ/Night Mode command found; don't promise these controls. Reference: https://www.home-assistant.io/integrations/hdmi_cec/
5. IMPORTANT immediate no-IR Night Mode remedy: VIZIO official manual page 22 says Night Mode turns OFF after a power cycle. User can try soundbar Power OFF/ON and observe Night behavior, without resetting/pairing or buying IR hardware. A power cycle is not a factory reset; do not advise holding destructive reset button combinations.

## Agent questions
- Search for credible native V51-H6 Bluetooth Classic AVRCP/BLE GATT or alternate firmware control of EQ/Night/bass/treble. Mark absent evidence as UNVERIFIED, not impossible.
- Assess TV/Android TV HDMI CEC route for volume/mute, and carefully distinguish device EQ from source-only audio DSP.
- Determine whether direct Home Assistant SmartCast is possible for exact V51-H6 (likely NO), versus generic other VIZIO SmartCast soundbars (YES).
- Propose safe minimum physical confirmation and no-purchase approaches. IR emitters are OPTIONAL future fallback requiring separate approval.
- Never start live device commands, install Home Assistant, restart Docker, buy hardware, modify code, use paid seats or integrate into Android TV from this memo. Maintain prior Q18=D parked decision, Q79 still unanswered, and PM/security/approval boundaries.

## Agent-directed research dispatch
Sent read-only FREE/LOCAL-FIRST requests over DSH bridge to vmixer2o2/claude-code seq 16232 and vmixlaptop2x6/remote seq 16233. Message queued is not proof agents completed research.
