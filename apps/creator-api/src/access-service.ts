import {
  creatorFeatures,
  type CreatorAccess,
  type CreatorSubscription,
} from "./domain.js";

export interface SubscriptionRepository {
  findCurrentForUser(userId: string): Promise<CreatorSubscription | null>;
  markExpired(subscriptionId: string, expiredAt: Date): Promise<void>;
}

function isExpired(subscription: CreatorSubscription, now: Date) {
  return subscription.expiresAt !== null && subscription.expiresAt <= now;
}

export class CreatorAccessService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkCreatorAccess(userId: string): Promise<CreatorAccess> {
    const subscription = await this.subscriptions.findCurrentForUser(userId);

    if (!subscription || subscription.status !== "active") {
      return {
        active: false,
        creatorIdentityId: null,
        features: [],
        subscription: null,
      };
    }

    const now = this.now();
    if (isExpired(subscription, now)) {
      await this.subscriptions.markExpired(subscription.id, now);
      return {
        active: false,
        creatorIdentityId: null,
        features: [],
        subscription: null,
      };
    }

    return {
      active: true,
      creatorIdentityId: subscription.creatorIdentityId,
      features: creatorFeatures,
      subscription: {
        plan: subscription.plan,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
      },
    };
  }
}
