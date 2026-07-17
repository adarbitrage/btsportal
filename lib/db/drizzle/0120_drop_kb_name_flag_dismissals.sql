-- Retire the possible_member_name review flag (never surfaced a real name;
-- transcript cleaning handles member-name privacy). Drops the reviewer
-- "Not a name" dismissal table and its data.
DROP TABLE IF EXISTS "kb_name_flag_dismissals" CASCADE;
