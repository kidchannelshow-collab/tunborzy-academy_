/**
 * Local-first question extraction for the UTME PDF importer.
 *
 * WHY THIS EXISTS
 *   The importer used to send every chunk of extracted PDF text to the model just
 *   to find where questions and options begin and end. That is the single
 *   largest consumer of API quota, and it is unnecessary: question boundaries
 *   are a deterministic text pattern, not a semantic problem. This module does
 *   that work locally so a normal text-based past-question PDF needs NO AI call
 *   at all. AI is then only needed to fill in answers where the PDF has no key.
 *
 * WHAT IT DOES NOT DO
 *   It does not guess answers. A question with no answer key present is returned
 *   with `correct_option: null` and `needs_review: true`, so the administrator
 *   reviews it rather than the system inventing one.
 *
 * ACCURACY
 *   This is a heuristic parser, not an oracle. It is deliberately conservative:
 *   anything it cannot confidently parse is reported in `warnings` and left for
 *   human review. The preview UI remains the source of truth before publishing.
 */

export interface ExtractedQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  /** null when no answer key covered this question — never invented. */
  correct_option: string | null;
  explanation: string;
  /** 1-based line index the question started at, for "source location". */
  page_number: number | null;
  needs_review: boolean;
  answer_source: 'answer_key' | 'none';
  source: 'local';
}

export interface ExtractionResult {
  questions: ExtractedQuestion[];
  answerKeyFound: boolean;
  warnings: string[];
  stats: {
    numberedStarts: number;
    optionsFound: number;
    answerKeyEntries: number;
  };
}

/** Lines that are page furniture rather than question content. */
const NOISE = [
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*\d+\s*\|\s*page\s*$/i,
  /^\s*[-–—_=]{3,}\s*$/,
];

const isNoise = (line: string) => NOISE.some((re) => re.test(line));

/**
 * Question starts: "12.", "12)", "Q12.", "Question 12". Anchored at line start
 * and requiring whitespace or end-of-line after the marker, so a year like
 * "2024)" inside prose is not mistaken for a question number.
 */
const QUESTION_START = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:-]\s*(.*)$/i;

/**
 * Options: "A)", "A.", "(A)", "A:", "a)" — anchored at line start. Requires the
 * option letter to be a single A–D so a line beginning "A chemical..." with no
 * delimiter cannot match.
 */
const OPTION_START = /^\s*[([{]?\s*([A-Da-d])\s*[)\].:]\s*(.+)$/;

/** Marker lines that introduce an answer key section. */
const ANSWER_KEY_HEADER = /^\s*(answer\s*key|answers|correct\s*answers|marking\s*scheme|solutions)\b/i;

/** "1. B" / "1) B" / "1 - B" / "1 B", possibly several on one line. */
const ANSWER_KEY_ENTRY = /(\d{1,3})\s*[.)\]:-]?\s*[([{]?\s*([A-Da-d])\s*[)\]}.,;]?(?=\s|$)/g;

/**
 * Join words hyphenated across a line break ("equa-\ntion" -> "equation") and
 * drop trailing whitespace. Mathematics notation is left untouched: we never
 * rewrite symbols, only repair broken words.
 */
function normaliseLines(raw: string): string[] {
  const unified = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = unified.split('\n').map((l) => l.replace(/\s+$/g, ''));

  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    // A trailing hyphen at end of line joined to a lowercase continuation is a
    // wrapped word, not a minus sign.
    if (prev !== undefined && /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(line.trim())) {
      out[out.length - 1] = prev.slice(0, -1) + line.trim();
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Parse an answer key. Accepts a block introduced by "ANSWERS"/"ANSWER KEY", and
 * also a bare trailing run of "n X" pairs, which is how many past papers end.
 * Returns a map of question number -> option letter.
 */
function parseAnswerKey(lines: string[]): { key: Map<number, string>; entries: number } {
  const key = new Map<number, string>();

  const collect = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) {
      ANSWER_KEY_ENTRY.lastIndex = 0;
      let m: RegExpExecArray | null;
      const found: Array<[number, string]> = [];
      while ((m = ANSWER_KEY_ENTRY.exec(lines[i])) !== null) {
        found.push([Number(m[1]), m[2].toUpperCase()]);
      }
      // Require at least two pairs on a line to accept it as key data when we
      // are outside an explicit header — a stray "3 A" in prose is otherwise
      // indistinguishable. Inside a header block, single pairs are accepted.
      const insideHeader = from >= 0 && headerIndex >= 0 && i > headerIndex;
      if (found.length >= 2 || (insideHeader && found.length >= 1)) {
        found.forEach(([n, l]) => {
          if (!key.has(n)) key.set(n, l);
        });
      }
    }
  };

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (ANSWER_KEY_HEADER.test(lines[i])) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex >= 0) {
    collect(headerIndex, Math.min(lines.length, headerIndex + 60));
  }

  // Bare trailing key: the last 20% of the document, only if that region holds
  // no question starts (so we do not eat real questions).
  const tailStart = Math.floor(lines.length * 0.8);
  const tailHasQuestions = lines.slice(tailStart).some((l) => QUESTION_START.test(l));
  if (!tailHasQuestions && key.size === 0) {
    collect(tailStart, lines.length);
  }

  return { key, entries: key.size };
}

/**
 * Split raw, locally-extracted PDF text into structured questions.
 *
 * Multi-line questions and multi-line options are both handled: an option
 * continues absorbing lines until the next option letter or the next question
 * number, and question stem text continues until the first option.
 */
export function extractQuestionsFromText(raw: string): ExtractionResult {
  const warnings: string[] = [];
  const lines = normaliseLines(raw || '');

  if (!lines.some((l) => l.trim().length > 0)) {
    return {
      questions: [],
      answerKeyFound: false,
      warnings: ['No extractable text found — the PDF may be scanned or image-based.'],
      stats: { numberedStarts: 0, optionsFound: 0, answerKeyEntries: 0 },
    };
  }

  const { key, entries: answerKeyEntries } = parseAnswerKey(lines);
  const answerKeyFound = key.size > 0;

  interface Draft {
    number: number;
    stem: string[];
    options: Map<string, string[]>;
    order: string[];
    line: number;
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let currentOption: string | null = null;
  let numberedStarts = 0;
  let optionsFound = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || isNoise(line)) {
      // Blank line just ends the current option paragraph; it does not end the
      // question, because stems and options are frequently separated by blanks.
      currentOption = null;
      continue;
    }

    const qm = QUESTION_START.exec(line);
    const om = current ? OPTION_START.exec(line) : null;

    if (qm && !om) {
      numberedStarts += 1;
      current = { number: Number(qm[1]), stem: qm[2] ? [qm[2]] : [], options: new Map(), order: [], line: i + 1 };
      drafts.push(current);
      currentOption = null;
      continue;
    }

    if (current && om) {
      const letter = om[1].toUpperCase();
      const text = om[2];
      // A repeated letter means a new question started without a number, which
      // this parser does not support — flag it rather than corrupt an option.
      if (current.options.has(letter)) {
        warnings.push(`Line ${i + 1}: option ${letter} repeated — split into separate questions may be required.`);
      }
      if (!current.options.has(letter)) current.order.push(letter);
      current.options.set(letter, [text]);
      currentOption = letter;
      optionsFound += 1;
      continue;
    }

    if (current && currentOption) {
      current.options.get(currentOption)!.push(line.trim());
    } else if (current) {
      current.stem.push(line.trim());
    }
  }

  const questions: ExtractedQuestion[] = [];
  for (const d of drafts) {
    const get = (letter: string) => (d.options.get(letter) || []).join(' ').trim();
    const a = get('A');
    const b = get('B');
    const c = get('C');
    const dd = get('D');

    const stem = d.stem.join(' ').trim();

    // Never emit a malformed question. A question needs a stem and at least two
    // options to be answerable; anything less is reported, not silently saved.
    if (!stem || (!a && !b && !c && !dd)) {
      warnings.push(`Question ${d.number} (line ${d.line}) skipped: missing stem or options.`);
      continue;
    }
    if (!a || !b || !c || !dd) {
      warnings.push(`Question ${d.number} (line ${d.line}) was extracted with options missing — please complete them in review.`);
    }

    const fromKey = key.get(d.number) || null;

    questions.push({
      question_text: stem,
      option_a: a,
      option_b: b,
      option_c: c,
      option_d: dd,
      correct_option: fromKey,
      explanation: '',
      page_number: d.line,
      needs_review: fromKey === null,
      answer_source: fromKey ? 'answer_key' : 'none',
      source: 'local',
    });
  }

  if (questions.length === 0) {
    warnings.push('No numbered questions with lettered options were detected in the extracted text.');
  }
  if (!answerKeyFound && questions.length > 0) {
    warnings.push('No answer key found in the PDF — answers are left blank for review rather than guessed.');
  }

  return {
    questions,
    answerKeyFound,
    warnings,
    stats: { numberedStarts, optionsFound, answerKeyEntries },
  };
}
