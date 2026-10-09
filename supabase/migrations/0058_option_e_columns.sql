-- 0058 — Option E for every question bank.
--
-- WHY
--   A minority of past papers carry five options. The PDF importer's parser only
--   recognised A–D, and an "E) ..." line did not fail harmlessly: it matched no
--   option marker, so it fell through to the continuation branch and was appended
--   to the text of option D. The question survived with a corrupted D instead of
--   being dropped, which is far harder to notice in review.
--
--   Fixing the parser alone is not enough — there is nowhere to put the fifth
--   option. These columns are that place.
--
-- NULLABLE, NOT NOT NULL
--   A–D are NOT NULL because every question has four. E is present only on the
--   papers that print it, so it must be nullable: making it NOT NULL would reject
--   every existing question and every four-option import.
--
-- APPLIES TO ALL THREE BANKS
--   cbt_questions           — Undergraduate drilling
--   utme_questions          — UTME
--   post_utme_questions     — Post-UTME
--   They are separate tables with no shared parent, so each needs the column.
--
-- IDEMPOTENT
--   `IF NOT EXISTS` so this is safe to re-run, and safe on a database where the
--   column was already added by hand.
--
-- DEPLOY ORDER MATTERS
--   The application selects `option_e` explicitly (it cannot use `select('*')`,
--   because that would leak `correct_option` into the browser before grading).
--   PostgREST fails an ENTIRE query when a selected column does not exist, so a
--   build that reaches production before this migration takes every CBT down with
--   a 400. Run this FIRST.

ALTER TABLE public.cbt_questions
  ADD COLUMN IF NOT EXISTS option_e TEXT;

ALTER TABLE public.utme_questions
  ADD COLUMN IF NOT EXISTS option_e TEXT;

ALTER TABLE public.post_utme_questions
  ADD COLUMN IF NOT EXISTS option_e TEXT;

COMMENT ON COLUMN public.cbt_questions.option_e IS
  'Optional fifth option. NULL on the four-option majority of questions.';
COMMENT ON COLUMN public.utme_questions.option_e IS
  'Optional fifth option. NULL on the four-option majority of questions.';
COMMENT ON COLUMN public.post_utme_questions.option_e IS
  'Optional fifth option. NULL on the four-option majority of questions.';
