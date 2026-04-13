import { create, insertMultiple, search, type Orama } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { DEFAULT_EMBEDDING_MODEL, VectorDBSchemaDynamic, getDimensionsForModel } from "embedManager";
import { setIsUpdatingSettings } from "indexManager";

// Use `any` for the Orama type parameter because the vector dimension is dynamic
// (e.g. 'vector[1536]' or 'vector[3072]') and cannot be expressed as a static string literal type.
export type OramaInstance = Orama<any>;

export async function loadVectorDatabase(settings: any, forceNew: boolean = false, model: string = DEFAULT_EMBEDDING_MODEL): Promise<OramaInstance> {

  // Detect model change — if the model has changed (or lastEmbeddingModel is missing), force a fresh database
  const modelChanged = !settings.lastEmbeddingModel || settings.lastEmbeddingModel !== model;
  if (modelChanged) {
    forceNew = true;
  }

  let oramaInstance: OramaInstance;

  async function createNewDatabase(): Promise<OramaInstance> {
    const dimensions = getDimensionsForModel(model);
    return await create({
      schema: {
        id: 'string',
        lastUpdated: 'number',
        content: 'string',
        embedding: `vector[${dimensions}]` as const,
      },
      id: 'main-orama-db',
    });
  }

  if (!settings.VectorDBLogseqCopilot || settings.VectorDBLogseqCopilot === ''|| forceNew) {
    const freshDB = await createNewDatabase();
    const jsonIndex = await persist(freshDB, 'json');
    await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex, lastEmbeddingModel: model,});
    oramaInstance = await restore('json', jsonIndex);
  }

  else {

    try {
      oramaInstance = await restore('json', settings.VectorDBLogseqCopilot);
    }
    catch (error) {
      console.log("Error: database couldn't be recovered from settings. Resetting...");
      const freshDB = await createNewDatabase();
      const jsonIndex = await persist(freshDB, 'json');
      await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex, lastEmbeddingModel: model,});
      oramaInstance = await restore('json', jsonIndex);
    }
  }

  return oramaInstance;
}

export async function batchInsertEmbeddings(oramaDBInstance: OramaInstance, Embedings: VectorDBSchemaDynamic[]) {
  await insertMultiple(oramaDBInstance,Embedings);
  const jsonIndex = await persist(oramaDBInstance, 'json');
  setIsUpdatingSettings(true);
  try {
    await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex,});
  } finally {
    setIsUpdatingSettings(false);
  }
}

export async function vectorSearchOramaDB(oramaDBInstance: OramaInstance, vector: number[]) {
  const results = await search(oramaDBInstance, {
    mode: "vector",
    vector: {
      value: vector,
      property: "embedding",
    },
    similarity: 0.65, // Minimum similarity. Defaults to `0.8`
    includeVectors: false, // Defaults to `false`
    limit: 5, // Defaults to `10`
    offset: 0, // Defaults to `0`
  });
  return results
}