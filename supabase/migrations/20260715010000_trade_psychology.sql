-- Trade psychology capture: user-editable emotion vocabulary (seeded client-side with
-- a default set the first time a user has none -- see web/src/lib/emotions.ts -- rather
-- than seeded here, so future signups get the same defaults without a fresh migration),
-- tagged onto a trade per phase (before/during/after), plus two phase-specific notes.
-- Purely additive -- no existing table/column dropped or renamed.
begin;

-- ---------------------------------------------------------------------------
-- emotions (user-managed vocabulary, phase-bound -- the seed list has zero overlap
-- across phases, e.g. "FOMO" is inherently a before-the-trade feeling, so each
-- emotion belongs to exactly one phase rather than being reusable across all three)
-- ---------------------------------------------------------------------------
create table emotions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    phase text not null check (phase in ('before', 'during', 'after')),
    name text not null,
    sort_order integer not null default 0,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    unique (user_id, phase, name)
);

alter table emotions enable row level security;

create policy "emotions_select_own" on emotions for select using (auth.uid() = user_id);
create policy "emotions_insert_own" on emotions for insert with check (auth.uid() = user_id);
create policy "emotions_update_own" on emotions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "emotions_delete_own" on emotions for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- trade_emotions (many-to-many: a trade can carry several emotions per phase).
-- `phase` is denormalized from emotions.phase (same reasoning as executions.user_id
-- being denormalized from trades.user_id elsewhere in this schema) so it can be
-- queried/grouped without a join back to emotions. Primary key is (trade_id,
-- emotion_id) alone, not also phase -- an emotion is phase-bound by definition, so
-- the same emotion_id can never legitimately appear under two different phases for
-- one trade.
-- ---------------------------------------------------------------------------
create table trade_emotions (
    trade_id uuid not null references trades(id) on delete cascade,
    emotion_id uuid not null references emotions(id) on delete cascade,
    phase text not null check (phase in ('before', 'during', 'after')),
    created_at timestamptz not null default now(),
    primary key (trade_id, emotion_id)
);

alter table trade_emotions enable row level security;

create policy "trade_emotions_select_own" on trade_emotions for select using (
    exists (select 1 from trades where trades.id = trade_emotions.trade_id and trades.user_id = auth.uid())
);
create policy "trade_emotions_insert_own" on trade_emotions for insert with check (
    exists (select 1 from trades where trades.id = trade_emotions.trade_id and trades.user_id = auth.uid())
    and exists (select 1 from emotions where emotions.id = trade_emotions.emotion_id and emotions.user_id = auth.uid())
);
create policy "trade_emotions_delete_own" on trade_emotions for delete using (
    exists (select 1 from trades where trades.id = trade_emotions.trade_id and trades.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- trades: two new phase-specific notes. The existing `notes` column is untouched --
-- it stays the general per-trade journal field it always was; these are additive and
-- distinct (thesis = why the trade was taken, reflection = how it felt after).
-- ---------------------------------------------------------------------------
alter table trades add column thesis_note text;
alter table trades add column reflection_note text;

commit;
