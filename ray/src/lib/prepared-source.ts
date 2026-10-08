import { createHmac } from "crypto";
import { SignJWT, jwtVerify } from "jose";

interface PreparedSource {
  sourceRoot: string;
  repoUrl: string;
  branch: string;
  commitHash: string;
}

function signingKey() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Server authentication is not configured.");
  // Source proofs must never be usable as login tokens.
  return createHmac("sha256", secret).update("ray:prepared-source:v1").digest();
}

export async function signPreparedSource(userId: string, source: PreparedSource) {
  return new SignJWT({ ...source }).setProtectedHeader({ alg: "HS256" })
    .setSubject(userId).setAudience("ray-source-setup").setIssuedAt()
    .setExpirationTime("1h").sign(signingKey());
}

export async function verifyPreparedSource(token: unknown, userId: string): Promise<PreparedSource> {
  try {
    if (typeof token !== "string") throw new Error();
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"], audience: "ray-source-setup", subject: userId,
    });
    const { sourceRoot, repoUrl, branch, commitHash } = payload;
    if (![sourceRoot, repoUrl, branch, commitHash].every(value => typeof value === "string" && value)) throw new Error();
    return { sourceRoot, repoUrl, branch, commitHash } as PreparedSource;
  } catch {
    throw new Error("Repository setup has expired or is invalid. Prepare the repository again.");
  }
}
