import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresAdminRepository,
  PostgresCreatorFeaturesRepository,
  PostgresCreatorPlatformRepository,
  PostgresSubscriptionRepository,
} from "./postgres-repository.js";
import { PostgresEventsRepository } from "./postgres-events.js";
import { eventDefinitions } from "./events.js";

const databaseUrl = process.env.CREATOR_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL Creator lifecycle", () => {
  const sql = databaseUrl ? postgres(databaseUrl, { max: 2 }) : null;

  beforeAll(async () => {
    const migrations = await sql!<Array<{ name: string }>>`
      select name
      from creator_schema_migrations
      order by name
    `;
    expect(migrations.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "0013_site_analytics_and_telegram.sql",
        "0014_castaryn_accounts.sql",
        "0015_castaryn_identity_issuer.sql",
      ]),
    );
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("binds access to the connected Twitch channel and revokes it on disconnect", async () => {
    const subject = randomUUID();
    const email = `${subject}@integration.castaryn.test`;
    const platform = new PostgresCreatorPlatformRepository(sql!);
    const admin = new PostgresAdminRepository(sql!);
    const subscriptions = new PostgresSubscriptionRepository(sql!);
    const userId = await platform.ensureAccount({
      issuer: "https://identity.integration.castaryn.test/",
      subject,
      email,
      emailVerified: true,
    });

    try {
      const connection = await platform.upsertTwitchConnection({
        userId,
        channel: {
          id: `channel-${subject}`,
          login: `streamer_${subject.slice(0, 8)}`,
          displayName: "Integration Streamer",
        },
        token: {
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: ["channel:bot"],
        },
        encryptedAccessToken: "encrypted-access",
        encryptedRefreshToken: "encrypted-refresh",
      });

      await admin.grantLifetime({
        userId,
        adminSubject: "integration-admin",
        source: "developer_grant",
        reason: "integration test",
        now: new Date(),
      });

      const active = await subscriptions.findCurrentForUser(userId);
      expect(active?.streamingConnectionId).toBe(connection.connectionId);
      expect(active?.status).toBe("active");

      const events = new PostgresEventsRepository(sql!);
      const profile = await events.getOrCreateProfileForCreator(
        active!.creatorIdentityId,
      );
      const enabledProfile = await events.updateProfile(
        active!.creatorIdentityId,
        {
          name: profile.name,
          currencyName: profile.currencyName,
          enabled: true,
        },
      );
      expect(enabledProfile.isEnabled).toBe(true);
      await events.updateEventConfiguration(profile.id, "screamer", {
        name: "👻 Ужас",
        command: "!испуг",
        enabled: true,
        showInCatalog: true,
      });
      expect(
        (await events.listEventConfigurations(profile.id)).find(
          (event) => event.id === "screamer",
        ),
      ).toMatchObject({
        effectType: "SCREAMER",
        name: "👻 Ужас",
        command: "!испуг",
        enabled: true,
        showInCatalog: true,
      });
      await sql!`
        insert into event_consumer_presence (
          profile_id,
          consumer_type,
          consumer_id,
          last_seen_at
        )
        values (
          ${profile.id},
          'desktop',
          'integration-desktop',
          now()
        )
      `;
      await events.adjustBalance(
        profile.id,
        "viewer_1",
        "Viewer_1",
        "viewer-1",
        2_000,
      );
      const purchaseInput = {
        profileId: profile.id,
        viewerKey: "viewer_1",
        displayName: "Viewer_1",
        externalViewerId: "viewer-1",
        definition: eventDefinitions[0]!,
        now: new Date(),
      };
      const purchases = await Promise.all([
        events.purchase(purchaseInput),
        events.purchase(purchaseInput),
      ]);
      expect(purchases.map((result) => result.status).sort()).toEqual([
        "cooldown",
        "purchased",
      ]);
      expect(
        (await events.getBalance(
          profile.id,
          "viewer_1",
          "Viewer_1",
          "viewer-1",
        )).balance,
      ).toBe(1_000);
      // Simulates a YouTube-style viewer, whose stable identity (channel
      // id) differs from the human-typed display name -- resolveViewer must
      // find it by either, but must never invent a new balance row.
      await events.adjustBalance(profile.id, "ucviewer2", "Виктор Стример", "channel-2", 500);
      await expect(
        events.resolveViewer(profile.id, "ucviewer2"),
      ).resolves.toEqual({
        status: "found",
        viewerKey: "ucviewer2",
        displayName: "Виктор Стример",
      });
      await expect(
        events.resolveViewer(profile.id, "виктор стример"),
      ).resolves.toEqual({
        status: "found",
        viewerKey: "ucviewer2",
        displayName: "Виктор Стример",
      });
      await expect(
        events.resolveViewer(profile.id, "nobody-has-this-nickname"),
      ).resolves.toEqual({ status: "not_found" });
      await events.adjustBalance(profile.id, "ucviewer3", "Дубль", "channel-3", 1);
      await events.adjustBalance(profile.id, "ucviewer4", "Дубль", "channel-4", 1);
      await expect(
        events.resolveViewer(profile.id, "дубль"),
      ).resolves.toEqual({ status: "ambiguous" });
      expect(
        await events.refundTimedOut(
          new Date(purchaseInput.now.getTime() + 16_000),
        ),
      ).toBe(1);
      expect(
        (await events.getBalance(
          profile.id,
          "viewer_1",
          "Viewer_1",
          "viewer-1",
        )).balance,
      ).toBe(2_000);
      await sql!`
        update event_consumer_presence
        set last_seen_at = ${new Date(purchaseInput.now.getTime() + 16_000)}
        where profile_id = ${profile.id}
          and consumer_type = 'desktop'
          and consumer_id = 'integration-desktop'
      `;
      const secondPurchase = await events.purchase({
          ...purchaseInput,
          now: new Date(purchaseInput.now.getTime() + 16_000),
      });
      expect(secondPurchase).toMatchObject({ status: "purchased" });
      if (secondPurchase.status === "purchased") {
        await expect(
          events.acknowledge(
            active!.creatorIdentityId,
            secondPurchase.effect.id,
            "desktop",
            new Date(purchaseInput.now.getTime() + 17_000),
          ),
        ).resolves.toBe(true);
      }
      const disabledProfile = await events.updateProfile(
        active!.creatorIdentityId,
        {
          name: profile.name,
          currencyName: profile.currencyName,
          enabled: false,
        },
      );
      expect(disabledProfile.isEnabled).toBe(false);
      expect(Number(disabledProfile.controlRevision)).toBeGreaterThan(
        Number(enabledProfile.controlRevision),
      );
      await expect(
        events.purchase({
          ...purchaseInput,
          now: new Date(purchaseInput.now.getTime() + 32_000),
        }),
      ).resolves.toMatchObject({ status: "disabled" });

      const features = new PostgresCreatorFeaturesRepository(sql!);
      const command = await features.createCommand(
        active!.creatorIdentityId,
        connection.connectionId,
        userId,
        {
          trigger: "!фарм",
          responseTemplate: "{progress}",
          accessLevel: "everyone",
          enabled: true,
        },
      );
      const cooldownInput = {
        commandId: command.id,
        channelId: `channel-${subject}`,
        chatterUserId: "viewer-1",
        now: new Date(),
        channelWindowMs: 1_000,
        userWindowMs: 5_000,
      };
      const cooldownResults = await Promise.all([
        features.acquireCommandCooldown(cooldownInput),
        features.acquireCommandCooldown(cooldownInput),
      ]);
      expect(cooldownResults.sort()).toEqual([false, true]);

      await platform.disconnectTwitch(userId, new Date());
      expect(await subscriptions.findCurrentForUser(userId)).toBeNull();
    } finally {
      await sql!`
        delete from streaming_commands
        where created_by_user_id = ${userId}
      `;
      await sql!`delete from castaryn_accounts where id = ${userId}`;
    }
  });

  it("keeps entitlement, owner role, and the Events profile after switching connected platforms", async () => {
    const subject = randomUUID();
    const email = `${subject}@integration.castaryn.test`;
    const platform = new PostgresCreatorPlatformRepository(sql!);
    const admin = new PostgresAdminRepository(sql!);
    const subscriptions = new PostgresSubscriptionRepository(sql!);
    const events = new PostgresEventsRepository(sql!);
    const userId = await platform.ensureAccount({
      issuer: "https://identity.integration.castaryn.test/",
      subject,
      email,
      emailVerified: true,
    });

    try {
      await platform.upsertTwitchConnection({
        userId,
        channel: {
          id: `channel-${subject}`,
          login: `streamer_${subject.slice(0, 8)}`,
          displayName: "Integration Streamer",
        },
        token: {
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: ["channel:bot"],
        },
        encryptedAccessToken: "encrypted-access",
        encryptedRefreshToken: "encrypted-refresh",
      });
      await admin.grantLifetime({
        userId,
        adminSubject: "integration-admin",
        source: "developer_grant",
        reason: "integration test",
        now: new Date(),
      });

      // creator_subscriptions.streaming_connection_id now points at the
      // Twitch connection above and is never updated again -- switching
      // platforms below must not affect entitlement.
      await platform.upsertYoutubeConnection({
        userId,
        channel: {
          id: `ytchannel-${subject}`,
          login: `ytchannel-${subject}`,
          displayName: "Integration YouTube",
        },
        token: {
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
        },
        encryptedAccessToken: "encrypted-access",
        encryptedRefreshToken: "encrypted-refresh",
      });
      await platform.disconnectTwitch(userId, new Date());

      const subscription = await subscriptions.findCurrentForUser(userId);
      expect(subscription?.status).toBe("active");

      const role = await events.resolveRole(
        userId,
        subscription!.creatorIdentityId,
      );
      expect(role).toBe("owner");

      await expect(
        events.getOrCreateProfileForCreator(subscription!.creatorIdentityId),
      ).resolves.toMatchObject({
        creatorIdentityId: subscription!.creatorIdentityId,
      });

      const adminRecord = await admin.findCreatorRecord(userId);
      expect(adminRecord?.subscription?.status).toBe("active");
    } finally {
      await sql!`delete from castaryn_accounts where id = ${userId}`;
    }
  });

  it("derives moderator UI access from a recent Twitch badge without invitations", async () => {
    const targetSubject = randomUUID();
    const moderatorSubject = randomUUID();
    const platform = new PostgresCreatorPlatformRepository(sql!);
    const admin = new PostgresAdminRepository(sql!);
    const targetUserId = await platform.ensureAccount({
      issuer: "https://identity.integration.castaryn.test/",
      subject: targetSubject,
      email: `${targetSubject}@integration.castaryn.test`,
      emailVerified: true,
    });
    const moderatorUserId = await platform.ensureAccount({
      issuer: "https://identity.integration.castaryn.test/",
      subject: moderatorSubject,
      email: `${moderatorSubject}@integration.castaryn.test`,
      emailVerified: true,
    });
    const moderatorTwitchId = BigInt(
      `0x${moderatorSubject.replaceAll("-", "").slice(0, 15)}`,
    ).toString();

    try {
      await platform.upsertTwitchConnection({
        userId: targetUserId,
        channel: {
          id: `target-${targetSubject}`,
          login: `target_${targetSubject.slice(0, 8)}`,
          displayName: "Target Streamer",
        },
        token: {
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: ["channel:bot"],
        },
        encryptedAccessToken: "encrypted-target-access",
        encryptedRefreshToken: "encrypted-target-refresh",
      });
      await platform.upsertTwitchConnection({
        userId: moderatorUserId,
        channel: {
          id: moderatorTwitchId,
          login: `moderator_${moderatorSubject.slice(0, 8)}`,
          displayName: "Twitch Moderator",
        },
        token: {
          expiresAt: new Date(Date.now() + 3_600_000),
          scopes: ["channel:bot"],
        },
        encryptedAccessToken: "encrypted-moderator-access",
        encryptedRefreshToken: "encrypted-moderator-refresh",
      });
      await admin.grantLifetime({
        userId: targetUserId,
        adminSubject: "integration-admin",
        source: "developer_grant",
        reason: "moderator role integration test",
        now: new Date(),
      });

      const subscriptions = new PostgresSubscriptionRepository(sql!);
      const targetAccess = await subscriptions.findCurrentForUser(targetUserId);
      const events = new PostgresEventsRepository(sql!);
      const profile = await events.getOrCreateProfileForCreator(
        targetAccess!.creatorIdentityId,
      );
      await events.rememberModeratorBadge(
        profile.id,
        "twitch",
        moderatorTwitchId,
        "Twitch Moderator",
        new Date(),
      );

      await expect(
        events.resolveRole(
          moderatorUserId,
          targetAccess!.creatorIdentityId,
        ),
      ).resolves.toBe("moderator");
      const workspaces = await new PostgresCreatorFeaturesRepository(
        sql!,
      ).listAccessibleCreators(moderatorUserId);
      expect(workspaces).toContainEqual(
        expect.objectContaining({
          creatorIdentityId: targetAccess!.creatorIdentityId,
          role: "moderator",
        }),
      );
    } finally {
      await sql!`
        delete from castaryn_accounts
        where id in (${targetUserId}, ${moderatorUserId})
      `;
    }
  });
});
