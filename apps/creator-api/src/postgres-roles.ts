import type { Sql } from "postgres";
import type { CreatorRole } from "./authorization.js";

// Shared by PostgresEventsRepository and PostgresCreatorFeaturesRepository so
// the owner/moderator policy -- including the moderator badge freshness
// window -- lives in exactly one place. Changing the window (or the
// ownership/subscription rules) here changes it everywhere `resolveRole` is
// used. Provider-agnostic: a moderator badge earned on Twitch only grants
// the role via a Twitch streaming_connection, and likewise for YouTube.
export async function resolveCreatorRole(
  sql: Sql,
  actorUserId: string,
  creatorIdentityId: string,
): Promise<CreatorRole | null> {
  const rows = await sql<Array<{ role: CreatorRole }>>`
    with active_creator as (
      select identities.id, identities.user_id
      from creator_identities identities
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id = identities.id
        and subscriptions.status = 'active'
        and (
          subscriptions.expires_at is null
          or subscriptions.expires_at > now()
        )
        -- Any currently-connected platform satisfies entitlement, not
        -- specifically the one subscriptions.streaming_connection_id
        -- happened to point at when the subscription was granted -- that
        -- value is never updated afterwards, so matching on it directly
        -- would deny owner/moderator role (and thus every permission check
        -- gated by it) to a creator who simply disconnected that one
        -- platform while still having another connected.
        and exists (
          select 1
          from streaming_connections connections
          where connections.creator_identity_id = identities.id
            and connections.disconnected_at is null
        )
      where identities.id = ${creatorIdentityId}
    )
    select candidate.role
    from (
      select 'owner'::text as role, 0 as priority
      from active_creator
      where user_id = ${actorUserId}

      union all

      select 'moderator'::text as role, 1 as priority
      from active_creator
      join event_profiles profiles
        on profiles.creator_identity_id = active_creator.id
      join event_moderator_badges badges
        on badges.profile_id = profiles.id
        and badges.verified_at >= now() - interval '30 minutes'
      join creator_identities actor_identity
        on actor_identity.user_id = ${actorUserId}
      join streaming_connections actor_connection
        on actor_connection.creator_identity_id = actor_identity.id
        and actor_connection.provider = badges.provider
        and actor_connection.external_channel_id = badges.external_user_id
        and actor_connection.disconnected_at is null
    ) candidate
    order by candidate.priority
    limit 1
  `;
  return rows[0]?.role ?? null;
}
