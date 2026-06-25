import { z } from "zod";
import type { DataModelId } from "../../src/types.js";

const integrationEnvSchema = z
  .object({
    CDF_PROJECT: z.string().min(1),
    CDF_CLUSTER: z.string().min(1).optional(),
    CDF_BASE_URL: z.string().url().optional(),
    CDF_CLIENT_NAME: z.string().min(1).default("industrial-model-integration-tests"),
    CDF_CLIENT_ID: z.string().min(1),
    CDF_CLIENT_SECRET: z.string().min(1),
    CDF_TOKEN_URL: z.string().url(),
    CDF_DATA_MODEL_EXTERNAL_ID: z.string().min(1).default("CogniteCore"),
    CDF_DATA_MODEL_SPACE: z.string().min(1).default("cdf_cdm"),
    CDF_DATA_MODEL_VERSION: z.string().min(1).default("v1"),
  })
  .refine((env) => Boolean(env.CDF_CLUSTER || env.CDF_BASE_URL), {
    message: "Either CDF_CLUSTER or CDF_BASE_URL must be set",
    path: ["CDF_CLUSTER"],
  });

type IntegrationEnvValues = z.infer<typeof integrationEnvSchema>;

function formatEnvError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("\n");
}

/** Typed CDF environment for integration tests. */
export class IntegrationTestEnv {
  private constructor(private readonly values: IntegrationEnvValues) {}

  static isAvailable(): boolean {
    return integrationEnvSchema.safeParse(process.env).success;
  }

  static fromProcessEnv(): IntegrationTestEnv {
    const result = integrationEnvSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid integration test environment:\n${formatEnvError(result.error)}`);
    }
    return new IntegrationTestEnv(result.data);
  }

  get clientName(): string {
    return this.values.CDF_CLIENT_NAME;
  }

  get project(): string {
    return this.values.CDF_PROJECT;
  }

  get baseUrl(): string {
    if (this.values.CDF_BASE_URL) {
      return this.values.CDF_BASE_URL.replace(/\/$/, "");
    }
    return `https://${this.values.CDF_CLUSTER}.cognitedata.com`;
  }

  get oauthScope(): string {
    return `${this.baseUrl}/.default`;
  }

  get tokenUrl(): string {
    return this.values.CDF_TOKEN_URL;
  }

  get clientId(): string {
    return this.values.CDF_CLIENT_ID;
  }

  get clientSecret(): string {
    return this.values.CDF_CLIENT_SECRET;
  }

  get dataModelId(): DataModelId {
    return {
      space: this.values.CDF_DATA_MODEL_SPACE,
      externalId: this.values.CDF_DATA_MODEL_EXTERNAL_ID,
      version: this.values.CDF_DATA_MODEL_VERSION,
    };
  }
}

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

/** Fetches CDF access tokens via client credentials (fresh token per auth cycle). */
export class CdfAccessTokenProvider {
  private inflight?: Promise<string>;

  constructor(private readonly env: IntegrationTestEnv) {}

  getToken = async (): Promise<string> => {
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.fetchToken().finally(() => {
      delete this.inflight;
    });
    return this.inflight;
  };

  private async fetchToken(): Promise<string> {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.env.clientId,
      client_secret: this.env.clientSecret,
      scope: this.env.oauthScope,
    });

    const response = await fetch(this.env.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch CDF access token (${response.status}): ${await response.text()}`,
      );
    }

    const payload = oauthTokenResponseSchema.parse(await response.json());
    return payload.access_token;
  }
}
