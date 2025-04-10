import { create, insertMultiple, type Orama, search } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { VectorDBSchemaDynamic } from "embedManager";

export type VectorDBSchema = {
  id: 'string';
  lastUpdated: 'number';
  content: 'string';
  embedding: 'vector[1536]';
};

export async function loadVectorDatabase(settings: any,forceNew: boolean = false): Promise <Orama<VectorDBSchema>>{

  let oramaInstance: Orama<VectorDBSchema>;

  async function createNewDatabase(): Promise<Orama<VectorDBSchema>> {
    return await create({
      schema: {
        id: 'string',
        lastUpdated: 'number',
        content: 'string',
        embedding: 'vector[1536]',
      },
      id: 'main-orama-db',
    });
  }

  if (!settings.VectorDBLogseqCopilot || settings.VectorDBLogseqCopilot === ''|| forceNew) {
    const freshDB = await createNewDatabase();
    const jsonIndex = await persist(freshDB, 'json');
    await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex,});
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
      await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex,});
      oramaInstance = await restore('json', jsonIndex);
    }
  }

  return oramaInstance;
}

export async function batchInsertEmbeddings(oramaDBInstance :Orama<VectorDBSchema>,Embedings:VectorDBSchemaDynamic[]){
  insertMultiple(oramaDBInstance,Embedings);
  const jsonIndex = await persist(oramaDBInstance, 'json');
  await logseq.updateSettings({VectorDBLogseqCopilot: jsonIndex,});
}

export async function vectorSearchOramaDB(oramaDBInstance :Orama<VectorDBSchema>,vector:number[]){
  const results = search(oramaDBInstance, {
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