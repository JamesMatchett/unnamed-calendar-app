import type { HandleFault } from "@calder/core";
import { HANDLE_MIN, handleFault, normaliseHandle } from "@calder/core";

export interface HandleState {
  /** Usable: long enough, and nobody else has it. */
  readonly ok: boolean;
  /** Different from the one they have now, so there is something to save. */
  readonly changed: boolean;
  readonly message: string;
  /** How to colour the message: a refusal, a confirmation, or a hint. */
  readonly tone: "bad" | "good" | "muted";
  readonly fault: HandleFault | null;
}

/**
 * What to say under the handle field, and whether to let somebody past it.
 *
 * One home for the words as well as the rule, because two screens set this
 * field and they disagreed about both. The rule itself is in @calder/core; the
 * sentences are here, since core carries no user-facing copy.
 *
 * Every reason says something. The failure this replaces was a button that
 * greyed out while the hint underneath carried on explaining what a handle is
 * for: true, unhelpful, and indistinguishable from the state where everything
 * is fine.
 *
 * "Free" is said out loud too, not just implied by the absence of a complaint.
 * A handle is the one field somebody is asked to invent while a stranger might
 * already have it, so the answer to "can I have this one" should be on the
 * screen rather than inferred from a button changing colour.
 *
 * `taken` is passed in rather than looked up here. Today that is a synchronous
 * read of the local directory and the answer is instant. When there is a server
 * it becomes a request, and this shape already survives that: the caller waits,
 * and until it knows, it says nothing rather than guessing.
 */
export function handleHint(
  raw: string,
  taken: boolean,
  /** What they have now, so an unchanged handle is not reported as free. */
  current?: string,
): HandleState {
  const handle = normaliseHandle(raw);
  const fault = handleFault(raw, taken);
  const changed = current === undefined ? handle.length > 0 : handle !== normaliseHandle(current);

  if (fault === "taken") {
    return { ok: false, changed, fault, tone: "bad", message: `&${handle} is taken. Try another.` };
  }
  if (fault === "too_short") {
    return {
      ok: false,
      changed,
      fault,
      tone: "bad",
      message: `A handle needs ${HANDLE_MIN} characters or more. &${handle} is ${handle.length}.`,
    };
  }
  if (fault === "empty") {
    return {
      ok: false,
      changed,
      fault,
      tone: "bad",
      message: "Pick a handle: letters, numbers, and . _ - between them.",
    };
  }

  return changed
    ? { ok: true, changed, fault: null, tone: "good", message: `&${handle} is free` }
    : {
        ok: true,
        changed,
        fault: null,
        tone: "muted",
        message: "How friends find you. Letters, numbers, and . _ - between them.",
      };
}
