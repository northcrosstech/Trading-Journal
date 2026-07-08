-- Color-coded strategy tags (GitHub-label style). The frontend restricts input to a
-- curated swatch set for legibility/consistency, so this stays a plain text column
-- rather than an enum -- no schema change needed if the palette is ever extended.
alter table strategies add column color text not null default '#3b82f6';
