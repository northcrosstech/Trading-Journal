-- Per-account default asset type for manual trade entry -- when adding a new manual
-- trade against a given account, the "options trade" checkbox on /trades/new defaults
-- from this instead of always defaulting to stock. Purely additive, backfills
-- existing accounts to 'stock' (today's actual default behavior), so nothing changes
-- for accounts that don't touch this setting.
alter table accounts add column default_asset_type text not null default 'stock' check (default_asset_type in ('stock', 'option'));
