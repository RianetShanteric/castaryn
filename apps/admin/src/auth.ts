import {
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";
import { z } from "zod";

const RuntimeConfigSchema = z.object({
  authority: z.string().url(),
  clientId: z.string().min(1),
  audience: z.string().min(1),
  apiUrl: z.string().url(),
});

export type AdminRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function readRuntimeConfig(): AdminRuntimeConfig {
  return RuntimeConfigSchema.parse({
    authority: import.meta.env.VITE_ADMIN_OIDC_AUTHORITY,
    clientId: import.meta.env.VITE_ADMIN_OIDC_CLIENT_ID,
    audience: import.meta.env.VITE_ADMIN_OIDC_AUDIENCE,
    apiUrl: import.meta.env.VITE_ADMIN_API_URL,
  });
}

export function createAdminUserManager(config: AdminRuntimeConfig) {
  const adminUrl = new URL("/admin/", window.location.origin).toString();
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: adminUrl,
    post_logout_redirect_uri: adminUrl,
    response_type: "code",
    scope: "openid profile email",
    extraQueryParams: { audience: config.audience },
    automaticSilentRenew: false,
    monitorSession: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export function isUsableAdminSession(user: User | null): user is User {
  return Boolean(user && !user.expired && user.access_token);
}
