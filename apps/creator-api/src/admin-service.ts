import { z } from "zod";
import type {
  SubscriptionPlan,
  SubscriptionSource,
  SubscriptionStatus,
} from "./domain.js";

export type AdminCreatorRecord = {
  userId: string;
  email: string;
  creatorIdentityId: string;
  streamingProvider: string | null;
  streamingChannelId: string | null;
  streamingChannelName: string | null;
  subscription: {
    id: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    source: SubscriptionSource;
    createdAt: Date;
    expiresAt: Date | null;
  } | null;
};

export interface AdminRepository {
  searchCreatorRecords(query: string): Promise<AdminCreatorRecord[]>;
  findCreatorRecord(userId: string): Promise<AdminCreatorRecord | null>;
  grantLifetime(input: {
    userId: string;
    adminSubject: string;
    source: SubscriptionSource;
    reason: string;
    now: Date;
  }): Promise<void>;
  changeSubscription(input: {
    subscriptionId: string;
    plan: SubscriptionPlan;
    expiresAt: Date | null;
    adminSubject: string;
    reason: string;
    now: Date;
  }): Promise<boolean>;
  cancelSubscription(input: {
    subscriptionId: string;
    adminSubject: string;
    reason: string;
    now: Date;
  }): Promise<boolean>;
}

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  search(query: string) {
    return this.repository.searchCreatorRecords(
      z.string().trim().min(2).max(128).parse(query),
    );
  }

  async getUser(userId: string) {
    const record = await this.repository.findCreatorRecord(
      z.string().uuid().parse(userId),
    );
    if (!record) throw new AdminResourceNotFoundError();
    return record;
  }

  async grantLifetime(
    adminSubject: string,
    userId: string,
    source: unknown,
    reason: unknown,
  ) {
    await this.repository.grantLifetime({
      userId: z.string().uuid().parse(userId),
      adminSubject,
      source: z
        .enum(["developer_grant", "gift"])
        .parse(source) satisfies SubscriptionSource,
      reason: z.string().trim().min(3).max(240).parse(reason),
      now: this.now(),
    });
    return this.getUser(userId);
  }

  async changePlan(
    adminSubject: string,
    subscriptionId: string,
    planInput: unknown,
    reasonInput: unknown,
  ) {
    const plan = z
      .enum(["trial", "monthly", "yearly", "lifetime"])
      .parse(planInput);
    const now = this.now();
    const expiresAt =
      plan === "lifetime"
        ? null
        : new Date(
            now.getTime() +
              (plan === "trial" ? 14 : plan === "monthly" ? 30 : 365) *
                24 *
                60 *
                60 *
                1000,
          );
    const changed = await this.repository.changeSubscription({
      subscriptionId: z.string().uuid().parse(subscriptionId),
      plan,
      expiresAt,
      adminSubject,
      reason: z.string().trim().min(3).max(240).parse(reasonInput),
      now,
    });
    if (!changed) throw new AdminResourceNotFoundError();
  }

  async cancel(
    adminSubject: string,
    subscriptionId: string,
    reasonInput: unknown,
  ) {
    const changed = await this.repository.cancelSubscription({
      subscriptionId: z.string().uuid().parse(subscriptionId),
      adminSubject,
      reason: z.string().trim().min(3).max(240).parse(reasonInput),
      now: this.now(),
    });
    if (!changed) throw new AdminResourceNotFoundError();
  }
}

export class AdminResourceNotFoundError extends Error {}
export class AdminStreamingConnectionRequiredError extends Error {}
