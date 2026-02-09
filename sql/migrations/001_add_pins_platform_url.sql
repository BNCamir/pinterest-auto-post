-- Add Pinterest pin URL to pins table (for Getlate platformPostUrl etc.)
alter table pins add column if not exists platform_url text;
