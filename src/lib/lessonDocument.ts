/**
 * The single codec for a lesson's content document.
 *
 * WHY THIS MODULE EXISTS
 *
 * A lesson's body is not a set of columns — it is one JSON blob in
 * `materials.description`. Three components used to parse that blob
 * independently (`LessonEditor`, `StudentLessonViewer`, and the admin preview),
 * each with its own `if (Array.isArray(parsed)) … else if (parsed.blocks) …`
 * ladder. Any change to the shape therefore had to be made in every copy or the
 * editor and the viewer silently disagreed about what a lesson contained.
 *
 * Now the shape is defined once, here, and every reader and writer goes through
 * `parseLessonDocument` / `serializeLessonDocument`. Adding a field is a change
 * to this file and nothing else.
 *
 * THE SHAPE, AND WHY IT CHANGED
 *
 * v1 (legacy, still read):  { blocks: LessonBlock[], attachments, publishSettings }
 *                           — or a bare `LessonBlock[]`, or a plain string.
 * v2 (current):             { version: 2, slides: LessonSlide[], attachments, publishSettings }
 *
 * A lesson is now a deck of up to `MAX_SLIDES` sections. v1 documents are not
 * migrated on disk — they are lifted into a single-slide v2 document at read
 * time and only rewritten when someone actually saves. That means an old lesson
 * keeps working without a backfill, and re-saving it silently upgrades it.
 *
 * PARSING NEVER THROWS. A malformed, empty, or missing `description` yields a
 * usable document with one empty section. The alternative — propagating the
 * error — is how a lesson ends up rendering as a blank page with the author's
 * work still sitting in the database.
 */

export type BlockType =
  | 'title'
  | 'intro'
  | 'main'
  | 'image'
  | 'audio'
  | 'video'
  | 'example'
  | 'formula'
  | 'diagram'
  | 'summary'
  | 'references';

export type MaterialCategory =
  | 'Lecture Notes'
  | 'Slides'
  | 'Video Lecture'
  | 'Audio Lecture'
  | 'Assignments'
  | 'Additional Resources';

export interface PublishSettings {
  status: 'Draft' | 'Under Review' | 'Published' | 'Archived' | 'Hidden';
  publishAt: string | null;
  unpublishAt: string | null;
  isLocked: boolean;
  visibility: 'Public' | 'Undergraduate Only' | 'Selected Departments' | 'Selected Faculties' | 'Selected Levels';
  isPremium: boolean;
  auditLogs: { action: string; by: string; date: string }[];
}

export const defaultPublishSettings: PublishSettings = {
  status: 'Draft',
  publishAt: null,
  unpublishAt: null,
  isLocked: false,
  visibility: 'Public',
  isPremium: false,
  auditLogs: [],
};

export interface LessonAttachment {
  id: string;
  name: string;
  type: 'pdf' | 'doc' | 'ppt' | 'excel' | 'zip' | 'video' | 'audio' | 'image' | 'link';
  size?: string;
  category: MaterialCategory;
  url: string;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface LessonBlock {
  id: string;
  type: BlockType;
  content: string;
  fileUrl?: string;
}

/** One section of a lesson. A single-section lesson is just a one-slide deck. */
export interface LessonSlide {
  id: string;
  /** Short label for the slide rail. Falls back to the slide's title block. */
  title: string;
  blocks: LessonBlock[];
}

export interface LessonDoc {
  version: 2;
  slides: LessonSlide[];
  attachments: LessonAttachment[];
  publishSettings: PublishSettings;
}

/** Hard cap on sections per lesson, enforced in the editor UI. */
export const MAX_SLIDES = 10;

/**
 * Ids for blocks, slides and attachments.
 *
 * Deliberately NOT `Date.now().toString()`, which the original editor used
 * everywhere. Two blocks added inside the same millisecond — trivially reachable
 * by pasting or by a scripted `handleAddBlock` — got the SAME id, and since
 * blocks are keyed by id, editing one then edited both.
 *
 * These ids live inside the JSON blob, never in a column, so the 32-bit
 * `order_index` integer trap does not apply here — but a collision-free id is
 * still what a keyed list needs.
 */
export function makeId(prefix = 'id'): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${uuid}`;
}

export function createBlock(type: BlockType, content = ''): LessonBlock {
  return { id: makeId('blk'), type, content, ...(type === 'image' || type === 'diagram' || type === 'audio' || type === 'video' ? { fileUrl: '' } : {}) };
}

/**
 * A fresh slide.
 *
 * The FIRST slide of a lesson keeps the original editor's default pair — a title
 * block and an introduction — because that is what authors expect to land on.
 * Later slides open with a section heading and an empty body.
 */
export function createSlide({ withLessonTitle = false } = {}): LessonSlide {
  return {
    id: makeId('sld'),
    title: '',
    blocks: withLessonTitle
      ? [createBlock('title', 'Untitled Lesson'), createBlock('intro', '')]
      : [createBlock('title', ''), createBlock('main', '')],
  };
}

export function createEmptyDocument(): LessonDoc {
  return {
    version: 2,
    slides: [createSlide({ withLessonTitle: true })],
    attachments: [],
    publishSettings: { ...defaultPublishSettings, auditLogs: [] },
  };
}

function coerceAttachments(value: unknown): LessonAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is LessonAttachment => !!a && typeof a === 'object' && typeof (a as any).url === 'string');
}

function coercePublishSettings(value: unknown): PublishSettings {
  if (!value || typeof value !== 'object') return { ...defaultPublishSettings, auditLogs: [] };
  const v = value as Partial<PublishSettings>;
  return {
    ...defaultPublishSettings,
    ...v,
    auditLogs: Array.isArray(v.auditLogs) ? v.auditLogs : [],
  };
}

function coerceBlocks(value: unknown): LessonBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is LessonBlock => !!b && typeof b === 'object' && typeof (b as any).type === 'string')
    .map((b) => ({
      id: typeof b.id === 'string' && b.id ? b.id : makeId('blk'),
      type: b.type as BlockType,
      content: typeof b.content === 'string' ? b.content : '',
      ...(typeof b.fileUrl === 'string' ? { fileUrl: b.fileUrl } : {}),
    }));
}

/**
 * Read a `materials.description` value into a usable document.
 *
 * Handles every shape that has ever been written:
 *   - a v2 object with `slides`
 *   - a v1 object with `blocks`
 *   - a bare `LessonBlock[]`
 *   - a plain string (the oldest lessons stored prose directly)
 *   - null / undefined / garbage
 *
 * Always returns at least one slide, so downstream code never has to special-case
 * the empty lesson.
 */
export function parseLessonDocument(raw: unknown): LessonDoc {
  const fallback = createEmptyDocument();
  if (raw === null || raw === undefined || raw === '') return fallback;

  let parsed: any = null;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON — a legacy plain-text description. Wrap it so the prose the
      // author wrote stays visible instead of being replaced by an empty body.
      return {
        ...fallback,
        slides: [{ id: makeId('sld'), title: '', blocks: [createBlock('main', raw)] }],
      };
    }
  } else {
    parsed = raw;
  }

  if (Array.isArray(parsed)) {
    return {
      version: 2,
      slides: [{ id: makeId('sld'), title: '', blocks: coerceBlocks(parsed) }],
      attachments: [],
      publishSettings: { ...defaultPublishSettings, auditLogs: [] },
    };
  }

  if (!parsed || typeof parsed !== 'object') return fallback;

  if (Array.isArray(parsed.slides)) {
    const slides: LessonSlide[] = parsed.slides.map((s: any) => ({
      id: typeof s?.id === 'string' && s.id ? s.id : makeId('sld'),
      title: typeof s?.title === 'string' ? s.title : '',
      // A slide stored with only `blocks` (written by an intermediate build) is
      // still readable, and a slide with a stray `content` string is not lost.
      blocks: Array.isArray(s?.blocks)
        ? coerceBlocks(s.blocks)
        : typeof s?.content === 'string' && s.content
          ? [createBlock('main', s.content)]
          : [],
    }));

    return {
      version: 2,
      slides: slides.length > 0 ? slides.slice(0, MAX_SLIDES) : fallback.slides,
      attachments: coerceAttachments(parsed.attachments),
      publishSettings: coercePublishSettings(parsed.publishSettings),
    };
  }

  if (Array.isArray(parsed.blocks)) {
    return {
      version: 2,
      slides: [{ id: makeId('sld'), title: '', blocks: coerceBlocks(parsed.blocks) }],
      attachments: coerceAttachments(parsed.attachments),
      publishSettings: coercePublishSettings(parsed.publishSettings),
    };
  }

  return fallback;
}

/** The exact string written to `materials.description`. */
export function serializeLessonDocument(doc: LessonDoc): string {
  return JSON.stringify({
    version: 2,
    slides: doc.slides,
    attachments: doc.attachments,
    publishSettings: doc.publishSettings,
  });
}

/** A slide's display label — its own title, else its title block, else its number. */
export function slideLabel(slide: LessonSlide | undefined, index: number): string {
  if (!slide) return `Section ${index + 1}`;
  const explicit = slide.title?.trim();
  if (explicit) return explicit;
  const fromBlock = slide.blocks.find((b) => b.type === 'title')?.content?.trim();
  if (fromBlock) return fromBlock;
  return `Section ${index + 1}`;
}

/**
 * What goes in `materials.title`.
 *
 * The first slide wins, because that is the lesson's own heading; a later slide's
 * title is only used when the first slide has none. This matches what the author
 * sees at the top of the editor, so the list and the editor never disagree.
 */
export function documentTitle(doc: LessonDoc): string {
  const first = doc.slides[0];
  const fromFirstBlock = first?.blocks.find((b) => b.type === 'title')?.content?.trim();
  if (fromFirstBlock) return fromFirstBlock;
  if (first?.title?.trim()) return first.title.trim();

  for (const slide of doc.slides) {
    const c = slide.blocks.find((b) => b.type === 'title')?.content?.trim();
    if (c) return c;
  }
  return 'Untitled Lesson';
}

/** Every block across every slide — for whole-lesson operations like summarising. */
export function allBlocks(doc: LessonDoc): LessonBlock[] {
  return doc.slides.flatMap((s) => s.blocks);
}

/** True when the document has no authored content in any slide. */
export function isDocumentEmpty(doc: LessonDoc): boolean {
  return doc.slides.every((s) => s.blocks.every((b) => !b.content?.trim() && !b.fileUrl));
}
