import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { requireEnv } from "./env";

// https://sandbox.auth.world.org/.well-known/openid-configuration (docs/research.md)
export const oidcEndpoints = (issuer: string) => ({
  authorize: `${issuer}/api/v1/authorize`,
  token: `${issuer}/api/v1/token`,
  jwks: `${issuer}/.well-known/jwks.json`,
});

export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function agentOidcConfig() {
  const e = requireEnv("AGENT_OIDC_ISSUER", "AGENT_OIDC_CLIENT_ID", "AGENT_OIDC_CLIENT_SECRET", "AGENT_OIDC_REDIRECT_URI");
  return {
    issuer: e.AGENT_OIDC_ISSUER.replace(/\/$/, ""),
    clientId: e.AGENT_OIDC_CLIENT_ID,
    clientSecret: e.AGENT_OIDC_CLIENT_SECRET,
    redirectUri: e.AGENT_OIDC_REDIRECT_URI,
  };
}
export type AgentOidcConfig = ReturnType<typeof agentOidcConfig>;

/** Always forces a fresh authentication (prompt=login, max_age=0). */
export function buildAuthorizeUrl(cfg: AgentOidcConfig, p: { state: string; nonce: string; codeVerifier: string }) {
  const url = new URL(oidcEndpoints(cfg.issuer).authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid",
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.codeVerifier),
    code_challenge_method: "S256",
    prompt: "login",
    max_age: "0",
  }).toString();
  return url.toString();
}

export async function exchangeCode(cfg: AgentOidcConfig, code: string, codeVerifier: string, fetchImpl = fetch) {
  const res = await fetchImpl(oidcEndpoints(cfg.issuer).token, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`token exchange failed: ${res.status} ${body.error ?? ""}`.trim());
  return body.id_token;
}

export interface VerifiedIdentity {
  sub: string;
  authTime: number; // seconds
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
export const remoteJwks = (issuer: string) => {
  let jwks = jwksCache.get(issuer);
  if (!jwks) jwksCache.set(issuer, (jwks = createRemoteJWKSet(new URL(oidcEndpoints(issuer).jwks))));
  return jwks;
};

export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string; audience: string; nonce: string; getKey: JWTVerifyGetKey },
): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(idToken, opts.getKey, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ["RS256"],
  });
  if (payload.nonce !== opts.nonce) throw new Error("nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("missing sub");
  if (typeof payload.auth_time !== "number") throw new Error("missing auth_time");
  return { sub: payload.sub, authTime: payload.auth_time };
}
