export type CreatorRole = "owner" | "moderator";

export type CreatorPermission =
  | "commands:create"
  | "commands:update"
  | "commands:delete"
  | "commands:preview"
  | "overlay:manage"
  | "events:view"
  | "events:manage"
  | "events:configure"
  | "events:profile"
  | "events:consume"
  | "connections:manage";

const rolePermissions = {
  owner: [
    "commands:create",
    "commands:update",
    "commands:delete",
    "commands:preview",
    "overlay:manage",
    "events:view",
    "events:manage",
    "events:configure",
    "events:profile",
    "events:consume",
    "connections:manage",
  ],
  moderator: [
    "commands:preview",
    "events:view",
    "events:configure",
  ],
} as const satisfies Record<CreatorRole, readonly CreatorPermission[]>;

export function can(
  role: CreatorRole,
  permission: CreatorPermission,
): boolean {
  return (rolePermissions[role] as readonly CreatorPermission[]).includes(
    permission,
  );
}
