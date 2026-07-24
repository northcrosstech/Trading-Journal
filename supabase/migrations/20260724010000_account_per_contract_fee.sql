-- Per-account commission rate ($ per contract/share, per fill) used to auto-calculate
-- the fees field on the manual trade entry form -- 0 means "don't auto-calculate,
-- leave fees at the existing manual default." Purely additive, backfills existing
-- accounts to 0 (today's actual behavior: fees always start at 0 and are typed in
-- by hand).
alter table accounts add column per_contract_fee numeric not null default 0;
