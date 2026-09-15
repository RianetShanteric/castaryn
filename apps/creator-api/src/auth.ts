import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthenticatedIdentity } from "./domain.js";

export type AuthenticateRequest = (
  authorizationHeader: string | undefined,
) => Promise<AuthenticatedIdentity>;

export type OidcSettings = {
  jwksUrl: URL;
  issuer: string;
  audience: string;
  requireVerifiedEmail?: boolean;
  allowedSubjects?: ReadonlySet<string>;
  requireMfa?: boolean;
};

function readBearerToken(header: string | undefined) {
  if (!header) {
    throw new Error("Authentication required");
  }

  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header);
  if (!match?.[1]) {
    throw new Error("Authentication required");
  }

  return match[1];
}

export function createOidcAuthenticator(
  settings: OidcSettings,
): AuthenticateRequest {
  const jwks = createRemoteJWKSet(settings.jwksUrl, {
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });

  return async (authorizationHeader) => {
    const token = readBearerToken(authorizationHeader);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: ["RS256", "ES256"],
      maxTokenAge: "15m",
      clockTolerance: 5,
    });

    const emailVerified = payload.email_verified === true;
    if (
      !payload.sub ||
      !payload.iss ||
      typeof payload.email !== "string" ||
      payload.email.length > 320 ||
      (settings.requireVerifiedEmail !== false && !emailVerified)
    ) {
      throw new Error("Authentication required");
    }
    if (
      settings.allowedSubjects &&
      !settings.allowedSubjects.has(payload.sub)
    ) {
      throw new Error("Authentication required");
    }
    if (settings.requireMfa) {
      const methods = Array.isArray(payload.amr)
        ? payload.amr.filter((value): value is string => typeof value === "string")
        : [];
      const assurance = typeof payload.acr === "string" ? payload.acr : "";
      if (
        !methods.some((method) =>
          ["mfa", "otp", "webauthn", "hwk"].includes(method.toLowerCase()),
        ) &&
        !/(mfa|multi.factor|webauthn)/i.test(assurance)
      ) {
        throw new Error("Authentication required");
      }
    }

    return {
      subject: payload.sub,
      issuer: payload.iss,
      email: payload.email.trim().toLowerCase(),
      emailVerified,
    };
  };
}
