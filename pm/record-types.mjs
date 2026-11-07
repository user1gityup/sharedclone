// record-types.mjs - the two record types pm carries (website blitz L6a).
//
//   contact_lead  CL-...   Event Contact CRM: a person or company met at an event (T-8b68240c)
//   opportunity   OPP-...  Lead Management pipeline (T-af9f057e)
//
// They share this file and nothing else: separate tables, separate id spaces, separate and
// DISJOINT status enums, separate ACLs and separate audit logs (records.mjs enforces all four).
// An Opportunity may cross-link to a Contact Lead. That is a link, never a conversion: no field
// is copied and the Contact's own permissions still govern the Contact. The cross-link is held
// on the Opportunity ALONE - T-8b68240c fixes the Contact Lead's fields and none of them is a
// link - so the Contact Lead declares no links field and therefore advertises no `link` action
// (records.mjs drops it). Linking is an Opportunity operation, granted on Opportunities.
import { defineRecordType, migrateRecordType } from './records.mjs'

/** Contact Lead statuses (T-8b68240c, verbatim). */
export const CONTACT_STATUSES = Object.freeze(['new', 'contacted', 'qualified', 'dormant', 'closed'])
/** Opportunity pipeline statuses. Deliberately disjoint from CONTACT_STATUSES. */
export const OPPORTUNITY_STATUSES = Object.freeze(['identified', 'qualifying', 'proposal', 'negotiation', 'won', 'lost', 'abandoned'])

/** Consent flags carried on every Contact Lead. */
export const CONSENT_FLAGS = Object.freeze(['consent_contact', 'consent_marketing', 'consent_share'])

export const CONTACT_LEAD = defineRecordType({
  type: 'contact_lead',
  label: 'Contact Lead',
  idPrefix: 'CL',
  idField: 'contactId',
  statuses: CONTACT_STATUSES,
  initialStatus: 'new',
  version: 1,
  // what makes two Contact Leads look like the same person or company. Suggestions only:
  // dedupe_suggest proposes, a human (or an update grant) decides.
  dedupe: [
    { key: 'email', label: 'same email address', fields: ['email'], normalize: 'email' },
    { key: 'phone', label: 'same phone number', fields: ['phone'], normalize: 'digits' },
    { key: 'name_organization', label: 'same name at the same organization', fields: ['name', 'organization'] },
  ],
  fields: {
    type: { type: 'enum', values: ['person', 'company'], required: true },
    name: { type: 'string', required: true, max: 200 },
    organization: { type: 'string', max: 200 },
    role_title: { type: 'string', max: 200 },
    email: { type: 'string', max: 320, pattern: 'email' },
    phone: { type: 'string', max: 50 },
    // event met at
    event_name: { type: 'string', max: 200 },
    event_date: { type: 'date' },
    event_venue: { type: 'string', max: 200 },
    source_channel: { type: 'enum', values: ['booth', 'talk', 'intro', 'badge_scan'] },
    notes: { type: 'notes' },
    tags: { type: 'tags' },
    consent_contact: { type: 'boolean', default: false },
    consent_marketing: { type: 'boolean', default: false },
    consent_share: { type: 'boolean', default: false },
    consent_recorded_at: { type: 'date' },
  },
})

export const OPPORTUNITY = defineRecordType({
  type: 'opportunity',
  label: 'Opportunity',
  idPrefix: 'OPP',
  idField: 'opportunityId',
  statuses: OPPORTUNITY_STATUSES,
  initialStatus: 'identified',
  terminal: ['won', 'lost'],
  // the pipeline, centrally controlled in pm
  transitions: {
    identified: ['qualifying', 'abandoned'],
    qualifying: ['proposal', 'lost', 'abandoned'],
    proposal: ['negotiation', 'lost', 'abandoned'],
    negotiation: ['won', 'lost', 'abandoned'],
    won: [],
    lost: [],
    abandoned: ['qualifying'],
  },
  version: 1,
  // Opportunities dedupe on their own keys. Nothing here is shared with the Contact CRM:
  // a duplicate Opportunity is never "the same record" as a Contact Lead.
  dedupe: [
    { key: 'title_organization', label: 'same title at the same organization', fields: ['title', 'organization'] },
  ],
  fields: {
    title: { type: 'string', required: true, max: 200 },
    organization: { type: 'string', max: 200 },
    summary: { type: 'text', max: 20000 },
    value_usd: { type: 'number', min: 0 },
    source: { type: 'enum', values: ['inbound', 'outbound', 'referral', 'event', 'scraper', 'partner'] },
    // deadlines
    due_date: { type: 'date' },
    next_action: { type: 'string', max: 200 },
    next_action_at: { type: 'date' },
    notes: { type: 'notes' },
    tags: { type: 'tags' },
    // cross-links to Event Contact CRM records: link only, no conversion
    contact_links: { type: 'links', linkTo: 'contact_lead' },
  },
})

export const RECORD_TYPES = Object.freeze([CONTACT_LEAD, OPPORTUNITY])

/** Create/bring forward every record table on `db`. Idempotent. */
export function migrateRecords(db) {
  return RECORD_TYPES.map((def) => migrateRecordType(db, def))
}
