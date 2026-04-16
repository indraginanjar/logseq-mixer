export interface BM25Result {
  id: string;
  content: string;
  score: number;
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

  /** Tokenize text: split on whitespace/punctuation, lowercase. */
  static tokenize(text: string): string[] {
    return text.toLowerCase().split(/[\s\p{P}]+/u).filter(Boolean);
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
    const queryTerms = BM25Index.tokenize(query);
    if (queryTerms.length === 0 || this.docCount === 0) {
      return [];
    }

    const scores = new Map<string, number>();

    for (const term of queryTerms) {
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
