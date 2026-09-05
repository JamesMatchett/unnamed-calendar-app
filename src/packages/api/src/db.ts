/**
 * The one DynamoDB client, and the one way tests replace it.
 *
 * Shared rather than per-module on purpose. Two modules each caching their own
 * client would each need their own injection point, and a test that pointed one
 * at a local engine while the other still held a real client would fail in a
 * way that reads as a logic bug: half the handler talking to dynalite and half
 * of it trying to reach AWS. One cache, one seam.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let cached: DynamoDBDocumentClient | undefined;

export function client(): DynamoDBDocumentClient {
  // Created on first use rather than at module load, so a cold start does no
  // work a warm invocation would repeat and tests can point it somewhere else
  // before anything reaches for it.
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return cached;
}

/** Tests inject their own engine; nothing else should call this. */
export function useClient(db: DynamoDBDocumentClient | undefined): void {
  cached = db;
}
