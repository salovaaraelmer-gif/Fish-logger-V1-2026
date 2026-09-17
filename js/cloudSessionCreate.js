/**
 * Cloud session create: sessions + session_anglers + session-scoped anglers.
 * Membership lives in `session_anglers`. `anglers` is the catch FK mapping.
 * @module cloudSessionCreate
 */

import { supabase } from "./supabase.js";
import {
  cloudSessionCreateUiError,
  normalizeParticipantIds,
  parseCreateFishingSessionResult,
} from "./sessionCloudParse.js";

export {
  cloudSessionCreateUiError,
  normalizeParticipantIds,
  parseCreateFishingSessionResult,
} from "./sessionCloudParse.js";

const MAX_PARTICIPANTS = 10;

/**
 * @param {{
 *   title: string,
 *   startedAtIso: string,
 *   participantIds: string[],
 *   notes?: string | null,
 * }} input
 * @returns {Promise<{ ok: true, sessionId: string, idByUserId: Map<string, string> } | { ok: false, error: string }>}
 */
export async function createCloudSessionWithParticipants(input) {
  const participantIds = normalizeParticipantIds(null, input.participantIds || []);
  if (participantIds.length === 0) {
    return { ok: false, error: "Select at least one angler." };
  }
  if (participantIds.length > MAX_PARTICIPANTS) {
    return { ok: false, error: "Too many participants for one session." };
  }

  const { data, error } = await supabase.rpc("create_fishing_session", {
    p_title: input.title ?? null,
    p_started_at: input.startedAtIso ?? null,
    p_participant_ids: participantIds,
    p_notes: input.notes ?? null,
  });

  if (error) {
    console.error("[session create] cloud RPC failed:", error.message);
    return { ok: false, error: cloudSessionCreateUiError(error.message) };
  }

  const parsed = parseCreateFishingSessionResult(data);
  if (!parsed.ok) {
    console.error("[session create] cloud RPC returned an incomplete result", data);
    return parsed;
  }

  for (const uid of participantIds) {
    if (!parsed.idByUserId.has(uid)) {
      console.error("[session create] cloud RPC missing participant mapping");
      const del = await supabase.from("sessions").delete().eq("id", parsed.sessionId).select("id");
      if (del.error) {
        console.error("[session create] rollback delete failed:", del.error.message);
      }
      return {
        ok: false,
        error: "The session was not started because participants could not be saved.",
      };
    }
  }

  return parsed;
}
