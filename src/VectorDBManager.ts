import { create, insertMultiple, search, type Orama } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { DEFAULT_EMBEDDING_MODEL, VectorDBSchemaDynamic, getDimensionsForModel } from "embedManager";
import { setIsUpdatingSettings } from "indexManager";
import type { StorageProvider } from "./storage/StorageProvider";

// Use `any` for the Orama type parameter because the vector dimension is dynamic
// (e.g. 'vector[1536]' or 'vector[3072]') and cannot be expressed as a static string literal type.
export type OramaInstance = Orama<any>;

/** Cached Orama instance to avoid deserializing hundreds of MB on every call */
let cachedInstance: OramaInstance | null = null;

/** Helper to update logseq settings without triggering the DB.onChanged loop */
async function updateSettingsGuarded(update: Record<string, unknown>): Promise<void> {
  setIsUpdatingSettings(true);
  try {
    await logseq.updateSettings(update);
  } finally {
    setIsUpdatingSettings(false);
  }
}

export async function loadVectorDatabase(
  settings: any,
  forceNew: boolean = false,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider
): Promise<OramaInstance> {

  // Detect model change
  const modelChanged = settings.lastEmbeddingModel && settings.lastEmbeddingModel !== model;
  if (modelChanged) {
    console.info(`[loadVectorDatabase] Model changed from "${settings.lastEmbeddingModel}" to "${model}". Forcing new DB.`);
    forceNew = true;
  }

  // Return cached instance if available and not forcing new
  if (cachedInstance && !forceNew) {
    return cachedInstance;
  }

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

  const existingData = await storageProvider.load();

  if (!existingData || forceNew) {
    console.info(`[loadVectorDatabase] Creating fresh DB. existingData=${!!existingData}, forceNew=${forceNew}`);
    const freshDB = await createNewDatabase();
    const jsonIndex = await persist(freshDB, 'json');
    await storageProvider.save(jsonIndex as string);
    await updateSettingsGuarded({ lastEmbeddingModel: model });
    cachedInstance = await restore('json', jsonIndex) as unknown as OramaInstance;
  } else {
    console.info('[loadVectorDatabase] Restoring existing DB from storage.');
    try {
      cachedInstance = await restore('json', existingData) as unknown as OramaInstance;
      const docCount = (cachedInstance as any)?.data?.docs?.count ?? 'unknown';
      console.info(`[loadVectorDatabase] Restored DB. Data length: ${existingData.length} chars, documents: ${docCount}`);
    } catch (error) {
      console.log("Error: database couldn't be recovered from storage. Resetting...");
      const freshDB = await createNewDatabase();
      const jsonIndex = await persist(freshDB, 'json');
      await storageProvider.save(jsonIndex as string);
      await updateSettingsGuarded({ lastEmbeddingModel: model });
      cachedInstance = await restore('json', jsonIndex) as unknown as OramaInstance;
    }
  }

  return cachedInstance!;
}

/** Get the current cached Orama instance (or load from storage if not cached) */
export async function getOrLoadVectorDatabase(
  settings: any,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider
): Promise<OramaInstance> {
  if (cachedInstance) {
    return cachedInstance;
  }
  return loadVectorDatabase(settings, false, model, storageProvider);
}

export async function batchInsertEmbeddings(
  oramaDBInstance: OramaInstance,
  Embedings: VectorDBSchemaDynamic[],
  storageProvider: StorageProvider
) {
  await insertMultiple(oramaDBInstance, Embedings);
  const jsonIndex = await persist(oramaDBInstance, 'json');
  await storageProvider.save(jsonIndex as string);
  // Update cache since the instance was mutated
  cachedInstance = oramaDBInstance;
}

export async function vectorSearchOramaDB(oramaDBInstance: OramaInstance, vector: number[]) {
  const results = await search(oramaDBInstance, {
    mode: "vector",
    vector: {
      value: vector,
      property: "embedding",
    },
    similarity: 0.5,
    includeVectors: false,
    limit: 5,
    offset: 0,
  });
  return results;
}
