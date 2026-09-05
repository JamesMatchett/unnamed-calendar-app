import type { HandleFault } from "@calder/core";
import { HANDLE_MIN, handleFault, normaliseHandle } from "@calder/core";

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
 */
export function handleHint(
  raw: string,
  taken: boolean,
): { ok: boolean; message: string; fault: HandleFault | null } {
  const fault = handleFault(raw, taken);
  const handle = normaliseHandle(raw);

  const message =
    fault === "taken"
      ? `&${handle} is taken. Try another.`
      : fault === "too_short"
        ? `A handle needs ${HANDLE_MIN} characters or more. &${handle} is ${handle.length}.`
        : fault === "empty"
          ? "Pick a handle: letters, numbers, dots and underscores."
          : "How friends find you. Letters, numbers, dots and underscores.";

  return { ok: fault === null, message, fault };
}
