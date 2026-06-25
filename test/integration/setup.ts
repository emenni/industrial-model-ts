import type { CogniteClient } from "@cognite/sdk";
import { CogniteClient as CogniteClientImpl } from "@cognite/sdk";
import { COGNITE_CORE_DATA_MODEL, CogniteCoreClient } from "../../src/cognite-core/index.js";
import { CdfAccessTokenProvider, IntegrationTestEnv } from "./env.js";

export function hasIntegrationCredentials(): boolean {
  return IntegrationTestEnv.isAvailable();
}

let env: IntegrationTestEnv | undefined;
let tokenProvider: CdfAccessTokenProvider | undefined;
let cogniteClient: CogniteClient | undefined;
let coreClient: CogniteCoreClient | undefined;

function getEnv(): IntegrationTestEnv {
  env ??= IntegrationTestEnv.fromProcessEnv();
  return env;
}

function getTokenProvider(): CdfAccessTokenProvider {
  tokenProvider ??= new CdfAccessTokenProvider(getEnv());
  return tokenProvider;
}

export function createIntegrationCogniteClient(): CogniteClient {
  if (cogniteClient) {
    return cogniteClient;
  }

  const config = getEnv();
  cogniteClient = new CogniteClientImpl({
    appId: config.clientName,
    project: config.project,
    baseUrl: config.baseUrl,
    oidcTokenProvider: getTokenProvider().getToken,
  });

  return cogniteClient;
}

export function createIntegrationCoreClient(): CogniteCoreClient {
  if (coreClient) {
    return coreClient;
  }

  const dataModel = getEnv().dataModelId;
  if (
    dataModel.space !== COGNITE_CORE_DATA_MODEL.space ||
    dataModel.externalId !== COGNITE_CORE_DATA_MODEL.externalId ||
    dataModel.version !== COGNITE_CORE_DATA_MODEL.version
  ) {
    throw new Error(
      "Integration tests currently require the CogniteCore v1 data model. " +
        "Set CDF_DATA_MODEL_SPACE, CDF_DATA_MODEL_EXTERNAL_ID, and CDF_DATA_MODEL_VERSION accordingly.",
    );
  }

  coreClient = new CogniteCoreClient(createIntegrationCogniteClient());
  return coreClient;
}

export async function listInstanceSpaces(limit = 1): Promise<string[]> {
  const response = await createIntegrationCogniteClient().spaces.list({ limit });
  return response.items.map((space) => space.space);
}
