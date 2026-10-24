---
name: project_dsh_profile_plugin_install
description: "How a DSH plugin actually reaches the running web profile — manual symlinks in ~/.dsh/profiles/node_modules, not pnpm install"
metadata: 
  node_type: memory
  type: project
  originSessionId: b416a3f3-4d9b-47c5-860e-f2c60e2b4850
  modified: 2026-09-04T05:53:10.814Z
---

A plugin added to `packages/bundle/base/cordis.patch.yml` or `packages/bundle/web-app/cordis.patch.yml` does NOT load until it is also linked into `~\.dsh\profiles\node_modules\@deepseek-ai\`. The loader resolves each row to `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>/lib/index.js` and boots with ERR_MODULE_NOT_FOUND otherwise.

The existing links (`dsh-tool-council`, `dsh-client-ui-council-budget`, `dsh-client-ui-openrouter-monitor`) are hand-made symlinks pointing into the repo at `apps/cli/node_modules/@deepseek-ai/dsh-base/node_modules/@deepseek-ai/<pkg>` for host packages and `.../dsh-web-app/node_modules/@deepseek-ai/<pkg>` for client packages. `pnpm install` creates those nested paths but does not create the profile links.

`~/.dsh/profiles/web/cordis.patch.yml` is an empty `[]` — plugin rows come from the repo bundle patches, so no profile edit is needed.

**Why:** two of the three steps are inside the repo and pass every gate; the third is outside it, so a green build still boots without the plugin.

**How to apply:** after adding a plugin, build its artifacts (`tsc -b <pkg>/tsconfig.json` then `tsdown --env.DSH_BUILD_FACE host|client --filter <name>` from the repo root — tsdown run from the package directory fails with "No workspace packages found"), then create the profile symlink and restart DSH. Port 3080 in use means an instance is already running. See [[project_green_energy_platform]].
