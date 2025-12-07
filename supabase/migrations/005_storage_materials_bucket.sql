-- Migration: Configure storage bucket and RLS for materials uploads
-- Run this in your Supabase SQL Editor or via supabase db push

-- Ensure the materials bucket exists and is public (needed for getPublicUrl)
insert into storage.buckets (id, name, public)
values ('materials', 'materials', true)
on conflict (id) do nothing;

-- Enable RLS on storage objects (should already be on, but safe to enforce)
alter table storage.objects enable row level security;

-- Drop old policies if they exist to keep the migration idempotent
drop policy if exists "Allow public read of materials" on storage.objects;
drop policy if exists "Allow authenticated upload to materials" on storage.objects;
drop policy if exists "Allow owners to update materials" on storage.objects;
drop policy if exists "Allow owners to delete materials" on storage.objects;

-- Anyone (public) can read files in the materials bucket.
create policy "Allow public read of materials"
on storage.objects for select
using (bucket_id = 'materials');

-- Only authenticated users can upload into the materials bucket.
create policy "Allow authenticated upload to materials"
on storage.objects for insert
with check (
  bucket_id = 'materials'
  and auth.role() = 'authenticated'
);

-- Only the uploader can update their own files in the materials bucket.
create policy "Allow owners to update materials"
on storage.objects for update
using (bucket_id = 'materials' and owner = auth.uid())
with check (bucket_id = 'materials' and owner = auth.uid());

-- Only the uploader can delete their own files in the materials bucket.
create policy "Allow owners to delete materials"
on storage.objects for delete
using (bucket_id = 'materials' and owner = auth.uid());



