---
name: project-leadforge
description: "LeadForge — Metro Manila digital-presence gap prospector living in billboard-platform; scope, where the council prompt and cost tool live, and what is still undecided"
metadata: 
  node_type: memory
  type: project
  originSessionId: dfaea078-4b4b-4631-8cce-fc05e5ff6689
  modified: 2026-09-05T09:47:29.990Z
---

LeadForge finds Metro Manila businesses missing a website, Facebook page,
Instagram, WhatsApp number or Grab listing, generates the missing asset as a
demo behind an expiring link, and offers to sell it to them. Started
2026-09-05.

**Scope is 500 businesses, not 10,000.** The user cut it from 10,000
deliberately, to keep Google query volume and pattern clearly inside Maps
Platform terms — narrow (one LGU, one vertical, one commercial tile at a time)
and timely (paced over days, TTL'd, never stockpiled). 10,000 is Phase 2 and
must not be designed for now.

**Where it lives:** a portable core at `billboard-platform/leadforge/` with no
Next.js imports, plus thin adapters at `app/api/leadforge/**` and
`app/(dashboard)/dashboard/leadforge/**`. Subfolder because it may become a
standalone product — extraction must be copy the folder, write new adapters.

**Two artefacts already exist:**
- `billboard-platform/LEADFORGE-COUNCIL-PROMPT.md` — the full DSH council
  prompt (dev plan + swarm plan + A/B design). Written to a file so headless
  Claude CLI can read it rather than copy-paste. It is the prompt itself, with
  no meta commentary, so it can be piped in whole.
- The cost model, published as an artifact:
  https://claude.ai/code/artifact/24cd39c4-a341-45c3-930a-32f45dbe4658
  Live ledger: cohort size, generation route, ad budget, free tiers. It is the
  specification for Milestone 0, which ports it into `leadforge/budget/` as an
  estimator plus a live spend meter reading `lib/mapsUsage.js`.

**Costed baseline** (check new numbers against these, don't re-derive):
Places is ~$0 at 500 because per-SKU free tiers absorb ~72 Nearby Search and
~715 Place Details calls. Generation is the only line that scales — ~$16
metered, or ~$0.16 via the archetype route (write ~5 sites properly, fill ~495
by field substitution). Whole pilot lands near $0.16 with SES free tier and no
WhatsApp templates. The same funnel at 10,000 costs roughly $500.

**DECIDED 2026-10-06 by the user (Claude Opus 5.5 session 31261f94):** starting LGU Makati, vertical restaurants/cafes, offer = billboard-platform advertising with the generated site as the hook. Build is direct (not via council) on branch feat/leadforge; M0 budget model committed 76bf2bc. Earlier wording, kept for history: which of the 16
Metro Manila cities to start in, which vertical, and whether "sell this to
them" means selling the generated site or selling billboard-platform ads with
the site as the hook.

**Why:** the user wants a compliant lead engine that a swarm can build, priced
before it is built, inside a $60/month budget.

**How to apply:** read `LEADFORGE-COUNCIL-PROMPT.md` before touching this
work — it carries every constraint. See [[reference-leadforge-api-findings]]
for the verified provider facts the prompt depends on, and
[[dsh-council-plugin]] for the approval gate the council stops at.
