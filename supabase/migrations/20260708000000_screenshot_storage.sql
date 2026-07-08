-- Private storage bucket for per-trade screenshots (StonkJournal-style fast logging).
-- Path convention: {user_id}/{trade_id}/{timestamp}-{filename} -- the RLS policies
-- below use the first path segment to restrict each user to their own folder, the
-- same pattern the app already uses for every other table.

insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', false)
on conflict (id) do nothing;

create policy "trade_screenshots_select_own"
on storage.objects for select
using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "trade_screenshots_insert_own"
on storage.objects for insert
with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "trade_screenshots_delete_own"
on storage.objects for delete
using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
);
