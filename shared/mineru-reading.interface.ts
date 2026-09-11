/** A reading projection of one published DM document-version parse. No storage locations or raw layout JSON. */
export interface MineruReaderSource {
  id: string;
  blockId: string;
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'image' | 'note';
  text?: string;
  items?: string[];
  cells?: string[];
  imagePath?: string;
  pageIndex: number;
  bbox: [number, number, number, number] | null;
  sourcePointer: string;
}
export interface MineruReadingProjection {
  documentVersionId: string;
  parseRunId: string;
  sources: MineruReaderSource[];
  /** Meaningful notes omitted by MinerU's main Markdown renderer, never running page furniture. */
  notes: Array<{ id: string; text: string }>;
  issues: Array<{ blockId: string; code: string }>;
}
