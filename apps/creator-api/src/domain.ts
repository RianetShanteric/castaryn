export const creatorFeatures = [
  "chat_commands",
  "moderators",
  "overlay",
  "remote_configuration",
  "events",
] as const;

export type CreatorFeature = (typeof creatorFeatures)[number];
export type SubscriptionPlan = "trial" | "monthly" | "yearly" | "lifetime";
export type SubscriptionStatus = "active" | "expired" | "cancelled";
export type SubscriptionSource = "payment" | "developer_grant" | "gift";

export type CreatorSubscription = {
  id: string;
  userId: string;
  creatorIdentityId: string;
  streamingConnectionId: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  createdAt: Date;
  expiresAt: Date | null;
};

export type CreatorAccess = {
  active: boolean;
  creatorIdentityId: string | null;
  features: readonly CreatorFeature[];
  subscription: {
    plan: SubscriptionPlan;
    expiresAt: string | null;
  } | null;
};

export type AuthenticatedIdentity = {
  subject: string;
  issuer: string;
  email: string;
  emailVerified: boolean;
};

export type AuthenticatedActor = {
  userId: string;
  email: string;
};
