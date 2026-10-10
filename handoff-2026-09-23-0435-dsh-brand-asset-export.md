---
name: handoff-2026-09-23-0435-dsh-brand-asset-export
description: Export of the DSH local-build sidebar logo, the whale mark and the "Into the Unknown" hero lockup as standalone SVG/PNG files
metadata:
  type: project
---

# Handoff 2026-09-23 04:35 — DSH brand asset export

- **Handoff id:** handoff-2026-09-23-0435-dsh-brand-asset-export
- **Updated:** 2026-09-23 04:35 local
- **Host:** vMixer · **Session:** dbdec08e-c4dd-4171-8abe-b380b6258ffe · **Model:** Claude Opus 5
- **Repo read from:** `~/Documents/claudecode/deepseek-harness` (read-only; nothing in the repo was touched)
- **Owner:** Claude Opus 5 · no collaborating agents

## Exact ask
"can you get me a copy of the dsh local build logo thats on the site and the whale and into the unknown"
Clarified mid-turn: the logo "above New Session in the left hand panel", and the whale + headline "above the prompt window".

## Where the art lives in the source
- Whale mark: `packages/client/ui-primitives/src/FishLogo.tsx` — single path, native 23.16×17.04, `currentColor`.
- Sidebar lockup: `packages/client/ui-sidebar/src/client/SidebarRoot.tsx:137` — `renderSlot('sidebar.brand.mark')` fallback `<FishLogo size={24}/>` + fallback name `DSH Local Build` (+ optional `DSH_CLIENT_COMMIT_HASH` badge). CSS `SidebarRoot.module.css` `.brandIdentity` gap 8/h 24, `.fallbackBrandName` 17px/600.
- Hero lockup: `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` `HeroShell` — `<FishLogo size={34}/>` + `hero.headline` = "Into the Unknown" + `hero.preview` = "Preview" badge. CSS `HeroShell.module.css` `.headline` 26px/500, cols 34/auto/auto gap 10; badge `-3px` left, `+2px` top.
- Tokens: ink `--dsw-alias-label-primary` = `#0F1115` light / `#F9FAFB` dark; badge bg `#E4EDFD` / `#34415B`, badge ink `#0E3074` / `#F9FAFB`, border `rgba(38,49,72,.06)` / `rgba(255,255,255,.08)`. UI font stack from `packages/client/ui-theme/src/styles/base.css`.

## Done, with evidence
Written to `~\Downloads\dsh-logos\` — 7 SVG + 6 PNG:
`dsh-whale.svg` (currentColor), `dsh-whale-on-{light,dark}.svg/.png`,
`dsh-local-build-logo-on-{light,dark}.svg/.png` (154.39×24),
`dsh-into-the-unknown-on-{light,dark}.svg/.png` (325.97×32).
- Text widths and baselines measured live in headless Chrome (`Segoe UI` resolves from the app's own stack) — brand 122.39px, hero 212.79px, Preview 46.18px.
- PNGs rendered by headless Chrome at 2× device scale, transparent background: hero 2608×256, sidebar 1236×192, whale 1024×754.
- Both lockup PNGs opened and visually confirmed correct.

## Not done / notes
- SVG lockups keep the wordmark as live `<text>` with the app's font stack; on a machine without Segoe UI they reflow. Converting glyphs to outlines was not done (no font tooling installed).
- Whale-only SVG is exact vector geometry and font-independent.
- Nothing committed; no repo files changed; no push.

## Next action
None outstanding unless the user wants outlined-text SVGs, other sizes, or the commit-hash badge variant of the sidebar lockup.
