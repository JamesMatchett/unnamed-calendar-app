import { normaliseHandle } from "@calder/core";
import { Platform, Share } from "react-native";

import { SITE } from "@/config";

/**
 * Where somebody who has not got the app yet is sent.
 *
 * A page on the domain rather than a store link, because the store depends on
 * the phone at the other end: the page works that out, and while the app is in
 * TestFlight it points there instead. See site/get/index.html.
 */
export const APP_INVITE_URL = `${SITE}/get`;

/**
 * A link that adds you as a friend, or installs the app trying (§7.1, §7.3).
 *
 * One URL doing both jobs, which is the whole point of a universal link: the
 * phone hands it to Cal&der if Cal&der is installed, and to the browser if it
 * is not, where site/add/index.html sends them on to the store. A store link
 * on the QR would be useless to the people most likely to scan it, who already
 * have the app; an app-scheme link would be a dead end for everybody else.
 *
 * The name rides along in the query string because there is no server to ask
 * who a handle belongs to. It is a display hint, chosen by whoever made the
 * code, and nothing treats it as proof: the handle is the part that gets
 * verified once there is something to verify it against.
 */
export const friendUrl = (handle: string, displayName: string): string =>
  // Normalised on the way in as well as on the way out. A stored handle can
  // never contain anything that needs escaping, so this changes nothing today;
  // it means the URL cannot become the one place a bad handle gets through,
  // which is the sort of thing that is only ever noticed by the person whose
  // code silently adds the wrong account.
  `${SITE}/add/${normaliseHandle(handle)}?n=${encodeURIComponent(displayName.trim().slice(0, 60))}`;

/**
 * Sharing a link, in the shape the OS wants it.
 *
 * The share sheet's top rows — the people you message most, then the apps you
 * message them in — are built by iOS, not by us, but only for shares it can
 * recognise as a link. A single string containing a URL is offered as text, and
 * text is what Copy and Save to Files are for; the same content passed with the
 * URL as its own item is a link, which is what WhatsApp, Messages and the
 * suggested-contacts row are ranked for. That difference is the whole of this
 * helper.
 *
 * Android's Share has no `url`, so there the link goes back into the message.
 * `subject` is what Mail puts in the subject line and is ignored elsewhere.
 *
 * Two things stay outside our control and are worth knowing before chasing
 * them: the suggestions row is built from who this person actually messages, so
 * it is empty on a fresh simulator, and React Native's Share exposes no way to
 * exclude activities, so Copy and Save to Files are always in the list further
 * down.
 */
export async function shareLink({
  text,
  url,
  subject,
}: {
  /** The sentence that goes with the link. */
  text: string;
  url: string;
  subject?: string;
}): Promise<void> {
  try {
    await Share.share(
      Platform.OS === "ios"
        ? { message: text, url }
        : { message: `${text} ${url}` },
      subject ? { subject } : undefined,
    );
  } catch {
    // Dismissing the sheet is not a failure, and there is nothing useful to say
    // about one that will not open.
  }
}

/** Bringing somebody who is not on Cal&der onto it. */
export const shareAppInvite = (): Promise<void> =>
  shareLink({
    text: "Come and plan things with me on Cal&der",
    url: APP_INVITE_URL,
    subject: "Plan things with me on Cal&der",
  });
