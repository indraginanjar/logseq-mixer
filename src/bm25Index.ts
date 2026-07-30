export interface BM25Result {
  id: string;
  content: string;
  score: number;
}

/** Stopwords that are too common to be useful in BM25 scoring.
 * Includes English and Indonesian function words.
 */
export const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'of', 'in', 'to', 'for',
  'with', 'on', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'no', 'if', 'then', 'than', 'so', 'very', 'just',
  // Indonesian
  'yang', 'dan', 'di', 'ini', 'itu', 'dengan', 'untuk', 'pada', 'adalah',
  'dari', 'dalam', 'tidak', 'akan', 'juga', 'sudah', 'ke', 'karena',
  'ada', 'bisa', 'oleh', 'saya', 'kita', 'kami', 'mereka', 'dia',
  'anda', 'atau', 'tetapi', 'jika', 'maka', 'telah', 'belum', 'masih',
  'hanya', 'lebih', 'sangat', 'banyak', 'satu', 'lain', 'semua',
  'sedang', 'harus', 'dapat', 'seperti', 'antara', 'saat', 'secara',
]);

/** Basic Indonesian stemmer — strips common affixes to find root words.
 * Returns the stem AND the original (both are used for matching).
 * This is intentionally simple to avoid over-stemming.
 */
function indonesianStem(token: string): string | null {
  if (token.length < 4) return null;
  let stem = token;
  // Strip common suffixes first
  stem = stem.replace(/(-?nya|kah|lah|pun)$/, '');
  stem = stem.replace(/(kan|an|i)$/, '');
  // Strip common prefixes
  stem = stem.replace(/^(meng?|mem|men|meny|me)/, '');
  stem = stem.replace(/^(ber|be)/, '');
  stem = stem.replace(/^(per|pe)/, '');
  stem = stem.replace(/^(di|ke|se)/, '');
  // Only return if stem is meaningful (at least 3 chars)
  if (stem.length >= 3 && stem !== token) return stem;
  return null;
}

export class BM25Index {
  private invertedIndex: Map<string, Map<string, number>>; // term → (docId → termFreq)
  private docLengths: Map<string, number>; // docId → token count
  private docContents: Map<string, string>; // docId → raw content
  private avgDocLength: number;
  private docCount: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.invertedIndex = new Map();
    this.docLengths = new Map();
    this.docContents = new Map();
    this.avgDocLength = 0;
    this.docCount = 0;
  }

  /** Tokenize text: split on whitespace/punctuation, lowercase.
   * Hyphenated words (e.g., Indonesian "baru-baru") are kept as compound tokens
   * AND also emit individual parts for broader matching.
   */
  static tokenize(text: string): string[] {
    const lower = text.toLowerCase();
    // Split on whitespace first
    const rawTokens = lower.split(/\s+/).filter(Boolean);
    const tokens: string[] = [];
    for (const raw of rawTokens) {
      // Strip leading/trailing punctuation
      const cleaned = raw.replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
      if (!cleaned) continue;
      // If it contains a hyphen between word chars (e.g., "baru-baru"), keep compound AND parts
      if (/^\w+(-\w+)+$/.test(cleaned)) {
        tokens.push(cleaned); // compound: "baru-baru"
        const parts = cleaned.split('-');
        for (const part of parts) {
          if (part) tokens.push(part); // individual parts
        }
      } else {
        // Split remaining punctuation within token
        const subTokens = cleaned.split(/[\p{P}]+/u).filter(Boolean);
        tokens.push(...subTokens);
      }
    }
    return tokens;
  }

  /** Build the index from all documents. Called on initialization. */
  buildFromDocuments(docs: Array<{ id: string; content: string }>): void {
    this.clear();
    for (const doc of docs) {
      this.addDocument(doc.id, doc.content);
    }
    this.recomputeAvgDocLength();
  }

  /** Update index entries for upserted documents. */
  upsertDocuments(docs: Array<{ id: string; content: string }>): void {
    for (const doc of docs) {
      // Remove existing entry if present, then re-add
      if (this.docContents.has(doc.id)) {
        this.removeDocumentFromIndex(doc.id);
      }
      this.addDocument(doc.id, doc.content);
    }
    this.recomputeAvgDocLength();
  }

  /** Remove documents from the index. */
  removeDocuments(ids: string[]): void {
    for (const id of ids) {
      if (this.docContents.has(id)) {
        this.removeDocumentFromIndex(id);
      }
    }
    this.recomputeAvgDocLength();
  }

  /** Clear the entire index. */
  clear(): void {
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.docContents.clear();
    this.avgDocLength = 0;
    this.docCount = 0;
  }

  /** Search the index, returning top-K results scored by BM25. */
  search(query: string, limit: number): BM25Result[] {
    const queryTerms = BM25Index.tokenize(query).filter(t => !STOPWORDS.has(t));
    if (queryTerms.length === 0 || this.docCount === 0) {
      return [];
    }

    // Expand query with Indonesian stems for broader matching
    const expandedTerms = [...queryTerms];
    for (const term of queryTerms) {
      const stem = indonesianStem(term);
      if (stem && !expandedTerms.includes(stem)) {
        expandedTerms.push(stem);
      }
    }

    const scores = new Map<string, number>();

    for (const term of expandedTerms) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const n = postings.size; // number of docs containing this term
      const idf = Math.log((this.docCount - n + 0.5) / (n + 0.5) + 1);

      for (const [docId, tf] of postings) {
        const docLength = this.docLengths.get(docId) ?? 0;
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        const termScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) ?? 0) + termScore);
      }
    }

    // Sort by score descending and take top limit
    const results: BM25Result[] = [];
    for (const [id, score] of scores) {
      if (score > 0) {
        results.push({
          id,
          content: this.docContents.get(id) ?? '',
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** Add a single document to the index (internal helper). */
  private addDocument(id: string, content: string): void {
    const tokens = BM25Index.tokenize(content);
    this.docContents.set(id, content);
    this.docLengths.set(id, tokens.length);
    this.docCount++;

    // Build term frequency map for this document
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    // Update inverted index
    for (const [term, freq] of termFreqs) {
      let postings = this.invertedIndex.get(term);
      if (!postings) {
        postings = new Map();
        this.invertedIndex.set(term, postings);
      }
      postings.set(id, freq);
    }
  }

  /** Remove a single document from the index (internal helper). */
  private removeDocumentFromIndex(id: string): void {
    const content = this.docContents.get(id);
    if (content === undefined) return;

    const tokens = BM25Index.tokenize(content);
    const termFreqs = new Set(tokens);

    // Remove from inverted index
    for (const term of termFreqs) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        postings.delete(id);
        if (postings.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    this.docContents.delete(id);
    this.docLengths.delete(id);
    this.docCount--;
  }

  /** Recompute average document length. */
  private recomputeAvgDocLength(): void {
    if (this.docCount === 0) {
      this.avgDocLength = 0;
      return;
    }
    let totalLength = 0;
    for (const length of this.docLengths.values()) {
      totalLength += length;
    }
    this.avgDocLength = totalLength / this.docCount;
  }
}
