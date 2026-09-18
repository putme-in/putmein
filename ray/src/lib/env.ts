export interface EnvVariable {
  key: string;
  value: string;
}

export interface PublicEnvVariable {
  key: string;
  value: string;
}

export interface PublicEnvResponse {
  exists: boolean;
  vars: PublicEnvVariable[];
}

const MASKED_ENV_VALUE = "********";

// Parses raw .env file string into key-value pairs.
export function parseEnv(content: string): EnvVariable[] {
  const vars: EnvVariable[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars.push({ key, value });
  }

  return vars;
}

export function toPublicEnvResponse(exists: boolean, content: string): PublicEnvResponse {
  return {
    exists,
    vars: parseEnv(content).map(({ key }) => ({
      key,
      value: MASKED_ENV_VALUE,
    })),
  };
}
