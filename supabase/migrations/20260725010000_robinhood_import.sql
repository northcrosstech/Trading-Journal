-- Robinhood CSV importer support. Purely additive; does not touch trade_key, the
-- upsert_trade_bundle RPC, or anything the Webull worker writes.
begin;

-- 'robinhood' is its own broker value (distinct from 'manual') purely for correct
-- labeling in the UI -- Robinhood accounts are still sync_mode = 'manual' (CSV import,
-- no live sync), same as any other manual account.
alter table accounts drop constraint accounts_broker_check;
alter table accounts add constraint accounts_broker_check check (broker in ('webull', 'schwab', 'manual', 'robinhood'));

-- import_key is the Robinhood importer's OWN dedup key -- deliberately not trade_key.
-- trade_key's unique(user_id, trade_key) constraint and the upsert_trade_bundle RPC
-- belong to the Webull sync worker; reusing it here would let a CSV re-import and a
-- live sync collide or silently overwrite each other's rows. import_key is a
-- deterministic hash of (account_id + contract/symbol + first fill's date/price/qty),
-- so re-running an overlapping CSV export is a no-op on rows already imported.
-- Imported trades still get trade_key = null, same as any other manual trade -- they
-- remain editable/deletable via the existing manual-trade UI.
--
-- Scoped to (user_id, account_id, import_key), not just (user_id, import_key), per
-- explicit instruction: a Robinhood trade and a Webull trade with coincidentally
-- similar fills must never collide, even if both ever produced the same key shape.
-- Nullable, so every non-Robinhood trade (import_key = null) is exempt -- Postgres
-- treats each null as distinct under a unique constraint, same pattern trade_key
-- already relies on.
alter table trades add column import_key text;
alter table trades add constraint trades_user_id_account_id_import_key_key unique (user_id, account_id, import_key);

commit;
