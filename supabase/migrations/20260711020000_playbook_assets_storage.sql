-- Private storage bucket shared by playbook example charts and missed-trade
-- screenshots -- one bucket, path-scoped, same RLS pattern as trade-screenshots.
-- Path convention:
--   {user_id}/playbooks/{playbook_id}/{timestamp}-{filename}
--   {user_id}/missed-trades/{missed_trade_id}/{timestamp}-{filename}

begin;

insert into storage.buckets (id, name, public)
values ('playbook-assets', 'playbook-assets', false)
on conflict (id) do nothing;

create policy "playbook_assets_select_own"
on storage.objects for select
using (
    bucket_id = 'playbook-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "playbook_assets_insert_own"
on storage.objects for insert
with check (
    bucket_id = 'playbook-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "playbook_assets_delete_own"
on storage.objects for delete
using (
    bucket_id = 'playbook-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
