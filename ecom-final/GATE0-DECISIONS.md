# Ecom final - Gate 0 decisions (user, 2026-10-05, asked by Claude Opus 5.5 on vmixer2o2 [0ff4af])

#3 E2E tool: Playwright (vitest stays for unit/API).
#4 Payments (test/sandbox only), behind one payment adapter interface:
  - Stripe test mode (Connect for marketplace splits)
  - PayMongo test mode (GCash, Maya, cards)
  - Crypto: Coinbase Commerce, BTCPay Server (testnet), NOWPayments sandbox, plus generic adapter + mock
  - Treez adapter and Dutchie Pay adapter (create them; mock where no sandbox)
#5 Regulated rules - ALL of: age gate 21+ (DOB at entry + ID check at checkout), per-jurisdiction rules engine
  (region allow/block, purchase limits, product-class limits), licensed-vendor-only listing with admin approval + expiry,
  immutable compliance audit log. NOTE: some plain-ecom (commerce) products also carry age gates - age gate is a
  per-product flag available in commerce too, not canna-only.
#6 Carriers: Shippo/EasyPost multi-carrier (test mode); Philippine couriers (LBC, J&T, Ninja Van, Lalamove - mocked
  adapters where no sandbox); Grab (GrabExpress); local delivery zones + store pickup.
#7 Accounting: built-in double-entry ledger (vendor balances, fees, payouts, refunds, CSV export) + QuickBooks Online
  sandbox sync.
Phase 2: APPROVED to auto-start headless after the 3 inspection reports land. Same seats (openai, claude, claude-work),
  Auto Mode, writes only on build/ecom-final branches of users/commerce/canna, local commits only, never push.
