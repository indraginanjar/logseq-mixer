import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankedHit } from './reranker';
import type { SearchResult } from './storage/StorageProvider';

vi.mock('./queryClassifier', () => ({
  classifyQuery: vi.fn(),
}));

vi.mock('./reranker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reranker')>();
  return {
    ...actual,
    mergeWithRRF: vi.fn(),
  };
});

import { hybridSearch } from './hybridSearch';
import { classifyQuery } from './queryClassifier';
import { mergeWithRRF } from './reranker';

const mockedClassifyQuery = vi.mocked(classifyQuery);
const mockedMergeWithRRF = vi.mocked(mergeWithRRF);

function makeStorageProvider(results: SearchResult[] | Error) {
  return {
    searchByVector: results instanceof Error
      ? vi.fn().mockRejectedValue(results)
      : vi.fn().mockResolvedValue(results),
    upsertDocuments: vi.fn(),
    deleteDocuments: vi.fn(),
    getDocumentMeta: vi.fn(),
    clear: vi.fn(),
  } as any;
}

function makeBm25Index(results: Array<{ id: string; content: string; score: number }> | Error) {
  return {
    search: results instanceof Error
      ? vi.fn().mockImplementation(() => { throw results; })
      : vi.fn().mockReturnValue(results),
  } as any;
}

describe('hybridSearch', () => {
  const query = 'test query';
  const queryEmbedding = [0.1, 0.2, 0.3];

  const vectorResults: SearchResult[] = [
    { id: 'v1', content: 'vector result 1', score: 0.9 },
    { id: 'v2', content: 'vector result 2', score: 0.8 },
  ];

  const bm25Results = [
    { id: 'b1', content: 'bm25 result 1', score: 2.5 },
    { id: 'b2', content: 'bm25 result 2', score: 1.8 },
  ];

  const mergedResults: RankedHit[] = [
    { id: 'v1', content: 'vector result 1', score: 0.9, rrfScore: 0.03, keywordScore: 0, vectorRank: 1, keywordRank: 3 },
    { id: 'b1', content: 'bm25 result 1', score: 2.5, rrfScore: 0.028, keywordScore: 1, vectorRank: 3, keywordRank: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockedClassifyQuery.mockReturnValue({ category: 'mixed', bm25Weight: 1, vectorWeight: 1 });
    mockedMergeWithRRF.mockReturnValue(mergedResults);
  });

  it('falls back to BM25 results when vector search fails', async () => {
    const storageProvider = makeStorageProvider(new Error('vector failure'));
    const bm25Index = makeBm25Index(bm25Results);

    const results = await hybridSearch(query, queryEmbedding, storageProvider, bm25Index);

    expect(storageProvider.searchByVector).toHaveBeenCalled();
    expect(bm25Index.search).toHaveBeenCalledWith(query, 5);
    expect(mockedMergeWithRRF).toHaveBeenCalledWith(
      bm25Results.map((r) => ({ id: r.id, content: r.content, score: r.score })),
      [],
      expect.objectContaining({ bm25Weight: 1, vectorWeight: 1 }),
    );
    expect(results).toEqual(mergedResults);
  });

  it('falls back to vector results when BM25 search fails', async () => {
    const storageProvider = makeStorageProvider(vectorResults);
    const bm25Index = makeBm25Index(new Error('bm25 failure'));

    const results = await hybridSearch(query, queryEmbedding, storageProvider, bm25Index);

    expect(bm25Index.search).toHaveBeenCalled();
    expect(storageProvider.searchByVector).toHaveBeenCalled();
    expect(mockedMergeWithRRF).toHaveBeenCalledWith(
      [],
      vectorResults.map((r) => ({ id: r.id, content: r.content, score: r.score })),
      expect.objectContaining({ bm25Weight: 1, vectorWeight: 1 }),
    );
    expect(results).toEqual(mergedResults);
  });

  it('returns empty array when both searches fail', async () => {
    const storageProvider = makeStorageProvider(new Error('vector failure'));
    const bm25Index = makeBm25Index(new Error('bm25 failure'));

    const results = await hybridSearch(query, queryEmbedding, storageProvider, bm25Index);

    expect(results).toEqual([]);
    expect(mockedMergeWithRRF).not.toHaveBeenCalled();
  });

  it('returns merged results when both searches succeed', async () => {
    const storageProvider = makeStorageProvider(vectorResults);
    const bm25Index = makeBm25Index(bm25Results);

    const results = await hybridSearch(query, queryEmbedding, storageProvider, bm25Index);

    expect(mockedMergeWithRRF).toHaveBeenCalledWith(
      bm25Results.map((r) => ({ id: r.id, content: r.content, score: r.score })),
      vectorResults.map((r) => ({ id: r.id, content: r.content, score: r.score })),
      expect.objectContaining({ k: 60, limit: 5, bm25Weight: 1, vectorWeight: 1 }),
    );
    expect(results).toEqual(mergedResults);
  });

  it('defaults to mixed weights when classifier throws', async () => {
    mockedClassifyQuery.mockImplementation(() => { throw new Error('classifier error'); });
    const storageProvider = makeStorageProvider(vectorResults);
    const bm25Index = makeBm25Index(bm25Results);

    const results = await hybridSearch(query, queryEmbedding, storageProvider, bm25Index);

    expect(mockedMergeWithRRF).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({ bm25Weight: 1, vectorWeight: 1 }),
    );
    expect(results).toEqual(mergedResults);
  });
});
