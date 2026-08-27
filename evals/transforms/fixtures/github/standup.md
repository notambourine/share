standup notes, acme pod, week of 2026-08-17 - pasted from slack, unedited

mon 8/17
- sam: picking up gift cards phase 1. schema first, then redeem. asking support
  how they want to issue cards until the purchase flow exists
- dana: typeahead is rebuilding the index every request, that's the 38ms. going
  to cache it
- jordan: saved carts has been at 10% for two weeks with nothing in the logs.
  taking it to 100% this week

wed 8/19
- sam: redeem works incl. partial. found the expired-card 500, fixing before
  merge. blocked-ish on the gift card purchase flow - need acme to say whether
  cards go on sale before or after the loyalty launch
- dana: typeahead in KV now, 11ms. the apostrophe crash from those two support
  tickets was the same code path, gone too
- jordan: carts at 100%, flag deleted. starting on loyalty ledger

fri 8/21
- sam: gift cards merged. docs page up
- dana: csv import header preview shipped, that closes the header-row confusion
  from the 2.4.0 tickets. also the e2e shards, ci is 7min from 22
- jordan: loyalty ledger + earn rules in, flag off everywhere. no redemption
  yet. dashboard v2 query layer is drafted but I need the points table decision
  before I go further
- all: the 2.5.1 rollback on thursday was the dashboard date picker. week view
  broke, backed it out, landed it properly in 2.5.2 the same afternoon. no
  customer impact, production was on the old build for 17 minutes

for the client call: they asked last week for a date on gift cards going on
sale. we can't answer it until they answer the before/after loyalty question.
