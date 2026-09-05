import { readFileSync } from "node:fs";

import {
  CreateTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dynalite from "dynalite";

/**
 * A real DynamoDB engine, with THIS project's table on it.
 *
 * dynalite rather than AWS's own emulator because it is a plain npm package:
 * no Docker, no Java, no service container in CI. The thing under test is key
 * construction and query semantics — sort order, begins_with, BETWEEN, sparse
 * index membership — which is exactly the part an engine has to get right and
 * a mock cannot check at all.
 *
 * The schema is READ FROM THE TERRAFORM rather than restated here. A test that
 * declares its own table proves the queries work against a table nobody has,
 * and the projection in particular is easy to get wrong in a way that only
 * appears in production: a GSI query can only return attributes the index
 * projects, so a field added to a list view and not to non_key_attributes is
 * silently absent from every row.
 */

const TF = new URL(
  "../../../terraform/modules/data/main.tf",
  import.meta.url,
);

/** The GSI1 projection, as Terraform declares it. */
export function projectedAttributes(source = readFileSync(TF, "utf8")) {
  const block = source.match(/non_key_attributes\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("GSI1's non_key_attributes have moved or been renamed");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export const TABLE = "calder-test-main";
export const INDEX = "GSI1";

/**
 * A fresh table on a fresh in-memory engine. Returns a document client.
 *
 * Port 0, so the OS assigns one. `node --test` runs each test FILE in its own
 * process, concurrently, so any fixed port is a collision between files rather
 * than within one — and a counter does not help, because each process starts it
 * again from the same number. The first version of this bound 4600 and hung
 * forever: `listen` reported EADDRINUSE on the error channel, and the promise
 * wrapped only the callback, so nothing ever settled it.
 */
export async function freshTable(tfSource) {
  const server = dynalite({ createTableMs: 0 });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address();

  const base = new DynamoDBClient({
    endpoint: `http://localhost:${port}`,
    region: "eu-west-2",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });

  await base.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: INDEX,
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: {
            ProjectionType: "INCLUDE",
            NonKeyAttributes: projectedAttributes(tfSource),
          },
        },
      ],
    }),
  );

  const db = DynamoDBDocumentClient.from(base);
  return { db, close: () => server.close() };
}
