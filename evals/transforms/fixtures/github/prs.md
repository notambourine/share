merged PRs, acme-storefront, 2026-08-17 to 2026-08-24
pulled with gh pr list --state merged --json number,title,body,comments

## #418 gift cards, phase 1

Balances, redemption, and a cart-page balance check. Partial redemption works:
a $50 card against an $80 order leaves $30 on the card and $30 to pay.
No purchase flow yet - cards are issued by support through the admin for now.

review: "expired card path returns 500" -> fixed in 2ee8f31 before merge.
docs: https://help.acme.example/gift-cards

## #421 saved carts to everyone

Saved carts were on for a 10% cohort since v2.4.0. Two weeks, no incidents, so
this takes it to 100% and deletes the flag and the cohort table.

review: approved, one note about the cohort table being dropped in the same
release rather than a follow-up. Went ahead - it holds nothing but the split.

## #423 cache the typeahead index

The index was rebuilt per request. Now it lives in KV with a 5 minute TTL.
p95 goes 38ms -> 11ms. Also fixes a crash on any query with an apostrophe,
which support had two tickets about.

## #425 csv import header preview

Bulk price import now shows the first three rows parsed, with the header row
labelled, and asks for a confirm before it writes. This is the fix for the
header-row confusion in the support tickets from the 2.4.0 window.

## #429 loyalty mvp, ledger and earn rules

Points ledger and an earn rule engine, 1 point per dollar. Behind flag
loyalty-mvp, off in every environment including staging. No redemption, no
tiers, no expiry - those are the next two PRs. Not client-visible yet.

## #430 e2e in 4 shards

CI wall clock 22min -> 7min. No product change.

open, not merged:
- #431 analytics dashboard v2, the query layer. draft, waiting on the schema
  question in #429's ledger (shared points table or not).
- #433 gift card purchase flow. blocked on a decision from acme: do gift cards
  go on sale before the loyalty launch or after?
