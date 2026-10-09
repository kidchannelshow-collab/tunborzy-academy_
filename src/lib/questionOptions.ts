/**
 * The option alphabet, in one place.
 *
 * Questions carry four options on most papers and five on a minority. The letter
 * list used to be spelled out inline at every render site — `['A','B','C','D']`
 * in the exam screen, in each question editor, and in each result view — so
 * adding a fifth option meant finding them all, and missing one silently hid the
 * option rather than failing.
 *
 * `E` is always offered as a possible letter; whether it APPEARS is decided per
 * question by whether that option has any text (see `availableOptionLetters`).
 * Nothing should render a fifth slot for a four-option question.
 */

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export type OptionLetter = (typeof OPTION_LETTERS)[number];

/**
 * The letters this question actually has text for, in order.
 *
 * Empty or whitespace-only options are excluded, so a paper that stores `''` in
 * `option_e` renders four options and a paper that stores text renders five —
 * without either caller needing to know which case it is in.
 */
export function availableOptionLetters(question: any): OptionLetter[] {
  return OPTION_LETTERS.filter(
    (letter) => String(question?.[`option_${letter.toLowerCase()}`] ?? '').trim().length > 0,
  );
}

/** True when the question carries a fifth option with text. */
export function hasOptionE(question: any): boolean {
  return String(question?.option_e ?? '').trim().length > 0;
}
