# Event Manager — Q&A Review (E1–E15)

**For ChatGPT.** This file goes with `ecom_event_tool_build_prompt_updated.md`, which is stored in the Shared Brain at `ecom-final/`.

## How to run this Q&A

1. Ask **one question per message**, in order: E1, then E2, and so on.
2. Show the question, its context line, and its options exactly as written below. Do not answer for the user and do not recommend an option.
3. The user may answer:
   - with one letter, e.g. `B`
   - with a combination, e.g. `A & C`
   - with "Other" and custom text
4. After each answer:
   - repeat back what was recorded in one line
   - ask the next question
5. If an answer conflicts with an earlier answer or a locked decision (listed below), say so in one line. Then ask the user whether to keep the answer or change it, and wait.
6. If the user says "skip", record `SKIPPED` and move on.
7. When all 15 are done, output the **Answer Record** block at the bottom, filled in, ready to paste back into the build prompt.

## Locked decisions (do not re-ask)

- The original 36-question interview stands, including:
  - Q24: the organizer invites existing Ecom brands
  - Q20: cannabis is browse-only on the web and sold through a licensed POS
  - Q31: the company sets retail prices
  - Q34: final closeout is manual, after reconciliation
  - Q36: full reuse, implementation and testing
- Three apps: `users` (identity), `commerce` (merchandise), `canna` (regulated cannabis). commerce and canna never share a database.
- Stripe is rejected for cannabis transactions.
- POS is Dutchie and Treez behind one interface.
- Ages 21+ only.
- MySQL with Prisma; deploy to a DreamHost VPS.
- No fake data in production.

---

## Questions

**E1. Where should the Event Manager core live?**
*The core covers events, schedules, booths, tickets, staff, equipment, and fees. Cannabis inventory and sales must stay in canna; merchandise stays in commerce.*
- A) Inside `commerce`, as a new module
- B) A new `events` service with its own database, linked to commerce and canna by API
- C) Split: tradeshow and festival core in `commerce`, festival cannabis parts in `canna`
- D) Other (describe)

**E2. Which jurisdictions must festivals support at launch?**
*canna supports California / Metrc only today.*
- A) California only
- B) Philippines
- C) Other U.S. states (name them)
- D) Other (describe)

**E3. Does the company currently hold a cannabis licence it would use to sell at festivals?**
- A) Yes, a retailer licence
- B) Yes, a microbusiness or other sales-authorized licence
- C) Yes, a temporary cannabis event organizer licence
- D) None yet; festivals will use participating operators' licences
- E) Other (describe)

**E4. Which lead tool should tradeshow leads go into?**
- A) The standalone Lead Intelligence hub (port 5180), with login added
- B) The copy embedded in billboard-platform
- C) Event lead tables that sync into the hub's ecomm feed
- D) Other (describe)

**E5. How is lead consent captured at the booth?**
*The lead tool has no consent field today.*
- A) Explicit opt-in checkbox at capture, recorded per brand
- B) Implied by ticket or badge terms when the badge is scanned
- C) A, with B as a fallback for badge scans
- D) Other (describe)

**E6. Who can be an "approved event organizer"?**
- A) Internal company staff only
- B) External partner organizations as well
- C) Both, with external organizers limited to their own events
- D) Other (describe)

**E7. How should "brand" relate to "vendor"?**
*No Brand model exists; everything is scoped per vendor today.*
- A) Treat each vendor as one brand
- B) Add Brand under Vendor (one vendor, many brands)
- C) Other (describe)

**E8. Which licensed POS do you have real API access to, or can get it for?**
*Dutchie and Treez connectors exist in sandbox form.*
- A) Dutchie
- B) Treez
- C) Another POS (name it)
- D) None yet; use real CSV/XLSX POS exports only

**E9. Which processor should collect event fees?**
*These are tickets, booth fees, and sponsor fees.*
- A) Stripe, once the company records approval for this category
- B) PayMongo
- C) Crypto, ACH, or invoice
- D) Manual or offline invoicing at first, with online payment disabled
- E) Other (describe)

**E10. How are brand wholesale settlements paid out?**
- A) ACH
- B) Check or manual bank transfer, with the payment reference recorded
- C) Crypto
- D) Invoiced terms (net-X)
- E) Other (describe)

**E11. What runs merchandise sales at the festival?**
*commerce has no POS today.*
- A) commerce web checkout on staff tablets
- B) Square
- C) Another POS (name it)
- D) Other (describe)

**E12. What hardware will run the festival menu screens?**
- A) Smart TVs with a built-in browser
- B) Streaming sticks or Chromebox-style players
- C) Laptops or tablets driving monitors
- D) Other (describe)

**E13. Must ticket buyers and attendees have a user account?**
- A) Yes, always
- B) No; guest purchase with email, account optional
- C) Account required only for 21+ or member-only events
- D) Other (describe)

**E14. What formats is your historical event data in?**
- A) CSV / XLSX spreadsheets
- B) POS exports (name the system)
- C) PDFs or scanned paper records
- D) Other (describe)

**E15. When should the event build start, relative to the main ecom build (16 of 21 steps done)?**
- A) After the main ecom build finishes all 21 steps
- B) Inventory and contracts (Phase 0–1) now; implementation after the canna and frontend steps merge
- C) Now, in parallel
- D) Other (describe)

---

## Answer Record

Output this block when all questions are answered:

```
# Event Manager Q&A — Answer Record
Date: <date>

E1  Event core location:        <answer>
E2  Festival jurisdictions:     <answer>
E3  Company cannabis licence:   <answer>
E4  Lead tool target:           <answer>
E5  Lead consent capture:       <answer>
E6  Organizer eligibility:      <answer>
E7  Brand vs vendor:            <answer>
E8  Licensed POS access:        <answer>
E9  Event fee processor:        <answer>
E10 Settlement payout rail:     <answer>
E11 Merchandise POS:            <answer>
E12 Menu screen hardware:       <answer>
E13 Attendee accounts:          <answer>
E14 Historical data formats:    <answer>
E15 Build start timing:         <answer>

Conflicts flagged and how resolved: <list or "none">
Custom answers (full text):     <list or "none">
```
