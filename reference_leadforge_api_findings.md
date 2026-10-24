---
name: reference-leadforge-api-findings
description: "Verified provider facts behind LeadForge: Google's discontinued credit, Grab's absent discovery API, and why neither WhatsApp nor Messenger is a cold channel"
metadata: 
  node_type: memory
  type: reference
  originSessionId: dfaea078-4b4b-4631-8cce-fc05e5ff6689
  modified: 2026-09-05T10:12:51.683Z
---

Checked against the providers on 2026-09-05, not recalled. Re-verify before
relying on them, but do not assume the older claims are still true.

**Google's $200/month Maps credit was discontinued 2025-03-01**, replaced by
per-SKU monthly free call allowances (~10,000 Essentials, ~5,000 Pro, ~1,000
Enterprise). `~/Documents/claudecode/CLAUDE.md` still asserts "zero
out-of-pocket spend using the monthly $200 recurring credit" — **that line is
stale and will mislead any agent that trusts it.** Not corrected in the file;
the user has not been asked yet. Free tiers are per SKU, which is why 500
businesses cost ~$0 and 10,000 does not.

**Grab: two separate surfaces, and the first answer was wrong.** Claude Opus 5
initially said "no Grab discovery API" after checking only developer.grab.com.
The user pushed back and was right. Corrected picture:

- *Merchant APIs* (developer.grab.com — GrabFood, Mart, Express, Pay, POS,
  Farefeed): merchant-scoped only. Confirmed from the generated SDK
  `github.com/grab/grabfood-api-sdk-go` — every endpoint manages the
  authenticated merchant's own orders, menu, hours and campaigns; OAuth2
  `client_credentials`, scope `food.partner_api`, and a pre-existing merchant
  ID is required. No search, no discovery, no onboarding endpoint.
- *GrabMaps* — a separate business, and a genuine discovery API. Reachable
  through Amazon Location Service in `ap-southeast-1` / `ap-southeast-5`,
  covers the Philippines, supports SearchNearby (category filter, shipped for
  GrabMaps 2026-07), SearchText, GetPlace, Suggest, ReverseGeocode. Built from
  Grab's own delivery and ride journeys, so small-business recall in Metro
  Manila may beat Google. Free tier ~20,000 Places requests/month for 3
  months, roughly 4x Google's Pro allowance.

**The catch that kills the original idea:** in the GrabMaps regions AWS marks
`Contacts` (websites, phones, emails), `OpeningHours` and `FoodTypes` as NOT
supported, and `AdditionalFeatures` is limited to `TimeZone` — which also rules
out `CrossReferences`. So GrabMaps returns Title, Address, Position, PlaceId,
PlaceType, Categories, BusinessChains, MapView, PlaceAttributes and TimeZone,
and **cannot tell you whether a business has a website.** GrabMaps is also a
general 50M-POI basemap covering businesses whether or not they sell on Grab,
so presence in it is not merchant status. No merchant flag was found; its
absence is unconfirmed and worth one empirical probe.

`IntendedUse` (SingleUse vs Storage) is unsupported in the GrabMaps regions,
so persistence rights there are unresolved — same class of constraint as
Google's caching rule, and it must be answered before designing storage.

Third-party Grab scrapers exist at ~$4/1,000 listings and breach Grab's terms.

**Neither WhatsApp nor Messenger permits a business to open a thread.**
Messenger allows promotional content only inside the 24 hours after the person
messages first; Message Tags reach outside that window but explicitly exclude
deals, offers, coupons and discounts. WhatsApp marketing templates need prior
opt-in and cold sends get the number banned. Meta moved WhatsApp to
per-message pricing 2025-07-01; service messages inside 24h are free.

**Facebook adoption in Metro Manila exceeds email adoption among small
businesses** — the user's point, and it is correct. It does not create a cold
DM channel. It makes two things valuable instead: paid click-to-Messenger ads,
where the prospect's own click opens the window legitimately, and business
contact details a Page publishes publicly, which are free and lawful to use. A
Page with a phone and no website is the target profile.

**Also verified:** Meta's Pages Search API was removed in 2018 and Instagram
Business Discovery needs a username you already have — so there is no
geographic search for either.

**How to apply:** these facts are load-bearing in
`billboard-platform/LEADFORGE-COUNCIL-PROMPT.md` (constraints C2, C3, C4). If
one changes, the prompt changes. See [[project-leadforge]].
