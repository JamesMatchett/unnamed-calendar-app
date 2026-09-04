/**
 * Deciding WHEN, when nobody knows yet. Architecture.md §8.1.
 *
 * Most shared events start as "we should do this soon" rather than a time, and
 * the thread that follows — six people, four dates, two of whom answer about a
 * date the others have stopped considering — is the single most common way a
 * plan dies. So the uncertainty is modelled rather than left in the chat: an
 * event can hold candidate SLOTS, people answer per slot, and an owner turns
 * the winner into the event's time.
 *
 * Two shapes, because groups differ:
 *   proposed — the organiser offers slots and people mark availability. Fast to
 *              answer, and the set stays small enough to compare.
 *   open     — anyone can add a slot as well as answer. Better when the
 *              organiser genuinely has no idea, at the cost of a longer list.
 *
 * Pure, so the same tallies and the same winner are computed on every client and
 * in the API. A poll where two people see different leaders is worse than no
 * poll at all.
 */

export type SchedulingMode = "fixed" | "proposed" | "open";

/**
 * "If need be" is the load-bearing option.
 *
 * With only yes and no, anyone who could make a date but would rather not says
 * yes, and the organiser cannot tell a keen date from a tolerated one. It is the
 * difference between a slot five people want and one five people are enduring.
 */
export type SlotResponse = "yes" | "if_need_be" | "no";

export interface SlotVote {
  readonly slotId: string;
  readonly userId: string;
  readonly response: SlotResponse;
}

export interface SlotTally {
  readonly slotId: string;
  readonly yes: number;
  readonly ifNeedBe: number;
  readonly no: number;
  /** Members who have not answered THIS slot. */
  readonly noResponse: number;
  /**
   * Ordering score. Yes counts fully, "if need be" counts for a third, and a no
   * is a real cost rather than a neutral absence: a slot two people cannot make
   * is worse than one nobody has answered, and scoring it as merely "not yes"
   * would let a date half the group has ruled out drift to the top.
   */
  readonly score: number;
}

export function tallySlot(
  slotId: string,
  votes: readonly SlotVote[],
  memberCount: number,
): SlotTally {
  const mine = votes.filter((v) => v.slotId === slotId);

  const yes = mine.filter((v) => v.response === "yes").length;
  const ifNeedBe = mine.filter((v) => v.response === "if_need_be").length;
  const no = mine.filter((v) => v.response === "no").length;

  return {
    slotId,
    yes,
    ifNeedBe,
    no,
    noResponse: Math.max(0, memberCount - mine.length),
    score: yes + ifNeedBe / 3 - no,
  };
}

export interface SlotLike {
  readonly slotId: string;
  /** ISO instant, used only to break ties. */
  readonly startUtc: string;
}

/**
 * Rank slots best first.
 *
 * Ties break on the earlier slot, because a date sooner is worth more than a
 * date later when both suit equally, and because a stable order matters more
 * than a clever one: a list that reshuffles between two people's phones is a
 * list nobody trusts.
 */
export function rankSlots(
  slots: readonly SlotLike[],
  votes: readonly SlotVote[],
  memberCount: number,
): (SlotTally & { startUtc: string })[] {
  return slots
    .map((s) => ({ ...tallySlot(s.slotId, votes, memberCount), startUtc: s.startUtc }))
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.startUtc < b.startUtc
          ? -1
          : a.startUtc > b.startUtc
            ? 1
            : 0,
    );
}

/**
 * The slot to suggest to the owner, or null when there is nothing to suggest.
 *
 * A leader is only offered once somebody has actually answered. Crowning the
 * earliest slot in a poll with no votes would put a recommendation behind a
 * number that means nothing, and an owner who accepts it has been misled by the
 * interface rather than helped by it.
 */
export function leadingSlot(
  slots: readonly SlotLike[],
  votes: readonly SlotVote[],
  memberCount: number,
): (SlotTally & { startUtc: string }) | null {
  if (votes.length === 0) return null;
  return rankSlots(slots, votes, memberCount)[0] ?? null;
}

/**
 * Is this slot a clear winner, or merely first?
 *
 * Used to decide whether to say "best so far" or stay quiet. A dead heat
 * announced as a winner is how an owner ends up picking a date half the group
 * cannot make.
 */
export function isClearWinner(
  ranked: readonly (SlotTally & { startUtc: string })[],
): boolean {
  const [first, second] = ranked;
  if (!first) return false;
  if (first.yes === 0) return false;
  return second === undefined || first.score > second.score;
}

/** Who may add a slot: everyone in an open poll, the owner otherwise. */
export function canProposeSlot(input: {
  readonly mode: SchedulingMode;
  readonly role: "owner" | "member" | null;
  readonly isEventOwner: boolean;
}): boolean {
  if (input.role === null) return false;
  if (input.mode === "fixed") return false;
  if (input.mode === "open") return true;
  return input.role === "owner" || input.isEventOwner;
}
