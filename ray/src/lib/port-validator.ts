export const MIN_TCP_PORT = 1;
export const MAX_TCP_PORT = 65535;

export interface PortValidationResult {
  valid: boolean;
  port?: number;
  error?: string;
}

/**
 * Validates that a given input is a valid TCP port number between 1 and 65535.
 */
export function validateTcpPort(input: unknown): PortValidationResult {
  if (input === undefined || input === null || input === "") {
    return { valid: false, error: "Port is required" };
  }

  const num = typeof input === "number" ? input : Number(String(input).trim());

  if (isNaN(num) || !Number.isInteger(num)) {
    return {
      valid: false,
      error: "Port must be a whole integer between 1 and 65535",
    };
  }

  if (num < MIN_TCP_PORT || num > MAX_TCP_PORT) {
    return {
      valid: false,
      error: `Port ${num} is out of valid range. TCP port must be between 1 and 65535.`,
    };
  }

  return {
    valid: true,
    port: num,
  };
}

export function isValidTcpPort(input: unknown): boolean {
  return validateTcpPort(input).valid;
}
