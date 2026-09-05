/**
 * Build-time facts about THIS build.
 *
 * One file, so a question like "is there a server yet" is answered in one
 * place and never by a screen guessing from a network error.
 */

/**
 * The alpha keeps everything on the phone. There is no server to talk to, so
 * every local write would otherwise sit at 'pending' forever, greyed out with
 * a spinner that never stops: to a tester that reads as broken, not as
 * offline. While this is true the app draws local writes as settled and says
 * so, once, in Settings.
 *
 * Flip it when sync lands. Nothing in the data model changes either way: writes
 * are still queued, so the day a server exists they go.
 */
export const LOCAL_ONLY = true;

/** Where the app lives on the web. The domain is the one machine-safe name. */
export const SITE = "https://calandder.com";
