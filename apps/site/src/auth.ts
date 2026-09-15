import type Keycloak from "keycloak-js";
import type {
  KeycloakProfile,
  KeycloakTokenParsed,
} from "keycloak-js";

const identityConfig = {
  url:
    import.meta.env.VITE_CASTARYN_OIDC_URL ??
    "https://control.castaryn.ru/auth",
  realm: import.meta.env.VITE_CASTARYN_OIDC_REALM ?? "castaryn",
  clientId: import.meta.env.VITE_CASTARYN_OIDC_CLIENT_ID ?? "castaryn-site",
};

let identity: Keycloak | null = null;
let identityLoading: Promise<Keycloak> | null = null;

export type AccountSession = {
  authenticated: boolean;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  subject: string | null;
};

let initialization: Promise<AccountSession> | null = null;

function getIdentity(): Promise<Keycloak> {
  identityLoading ??= import("keycloak-js").then(({ default: KeycloakClient }) => {
    identity = new KeycloakClient(identityConfig);
    return identity;
  });

  return identityLoading;
}

function accountUrl() {
  return `${window.location.origin}/account`;
}

function sessionFromIdentity(client: Keycloak): AccountSession {
  const claims = client.idTokenParsed as
    | (KeycloakTokenParsed & {
        email?: string;
        email_verified?: boolean;
        name?: string;
        preferred_username?: string;
      })
    | undefined;

  return {
    authenticated: client.authenticated === true,
    email: claims?.email ?? null,
    emailVerified: claims?.email_verified === true,
    name: claims?.name ?? claims?.preferred_username ?? null,
    subject: client.subject ?? null,
  };
}

export function initializeAccount(): Promise<AccountSession> {
  initialization ??= getIdentity().then(async (client) => {
    await client.init({
      onLoad: "check-sso",
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
      pkceMethod: "S256",
      responseMode: "query",
    });
    return sessionFromIdentity(client);
  });

  return initialization;
}

export async function signInAccount() {
  await initializeAccount();
  const client = await getIdentity();
  await client.login({
    redirectUri: accountUrl(),
    scope: "openid profile email",
  });
}

export async function registerAccount() {
  await initializeAccount();
  const client = await getIdentity();
  await client.register({
    redirectUri: accountUrl(),
    scope: "openid profile email",
  });
}

export async function signOutAccount() {
  await initializeAccount();
  const client = await getIdentity();
  await client.logout({ redirectUri: window.location.origin });
}

export async function loadAccountProfile(): Promise<KeycloakProfile | null> {
  const client = await getIdentity();
  if (!client.authenticated) return null;
  return client.loadUserProfile();
}

export async function refreshAccount(): Promise<AccountSession> {
  const client = await getIdentity();
  if (client.authenticated) {
    await client.updateToken(60);
  }
  return sessionFromIdentity(client);
}
