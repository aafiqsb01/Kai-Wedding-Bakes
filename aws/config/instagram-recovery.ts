import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  FAILURE_PREFIX,
  RECOVERY_PK,
  emptyBackfill,
  failureRecord,
  parseRecoveryItems,
  recoveryRecord,
  type InstagramRecoveryState,
  type RecoveryPosition,
} from "../functions/instagram-sync/recovery-state";
import { documentClient, TABLES } from "./database";

export class InstagramRecoveryStateError extends Error {
  constructor(operation: string) {
    super(`Failed to ${operation} Instagram sync recovery state`);
    this.name = "InstagramRecoveryStateError";
  }
}

function failureKey(mediaId: string): string {
  return `${FAILURE_PREFIX}${mediaId}`;
}

async function guard(operation: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(
      `Instagram sync recovery ${operation} failed: ${error instanceof Error ? error.name : "Error"}`
    );
    throw new InstagramRecoveryStateError(operation);
  }
}

export async function loadInstagramRecoveryState(): Promise<InstagramRecoveryState> {
  const failures: InstagramRecoveryState["failures"] = [];
  let position: RecoveryPosition | null = null;
  let startKey: Record<string, unknown> | undefined;

  try {
    do {
      const result = await documentClient.send(
        new QueryCommand({
          TableName: TABLES.INSTAGRAM_SYNC_RECOVERY,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": RECOVERY_PK },
          ExclusiveStartKey: startKey,
        })
      );

      const parsed = parseRecoveryItems((result.Items ?? []) as Array<Record<string, unknown>>);
      if (parsed.initialised) {
        position = parsed;
      }
      failures.push(...parsed.failures);

      startKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
  } catch (error) {
    if (error instanceof InstagramRecoveryStateError) throw error;
    console.error(
      `Instagram sync recovery read failed: ${error instanceof Error ? error.name : "Error"}`
    );
    throw new InstagramRecoveryStateError("read");
  }

  const base = position ?? emptyBackfill("");
  return {
    ...base,
    initialised: position !== null,
    failures,
  };
}

export async function initialiseInstagramRecovery(position: RecoveryPosition): Promise<void> {
  await guard("initialise", async () => {
    try {
      await documentClient.send(
        new PutCommand({
          TableName: TABLES.INSTAGRAM_SYNC_RECOVERY,
          Item: recoveryRecord(position),
          ConditionExpression: "attribute_not_exists(sk)",
        })
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return;
      throw error;
    }
  });
}

export async function saveInstagramRecovery(position: RecoveryPosition): Promise<void> {
  await guard("save", async () => {
    await documentClient.send(
      new PutCommand({
        TableName: TABLES.INSTAGRAM_SYNC_RECOVERY,
        Item: recoveryRecord(position),
      })
    );
  });
}

export async function recordInstagramRecoveryFailure(
  mediaId: string,
  instagramTimestamp: string | undefined,
  recordedAt: string
): Promise<void> {
  if (!mediaId.trim()) {
    throw new InstagramRecoveryStateError("record");
  }
  await guard("record", async () => {
    await documentClient.send(
      new PutCommand({
        TableName: TABLES.INSTAGRAM_SYNC_RECOVERY,
        Item: failureRecord(mediaId, instagramTimestamp, recordedAt),
      })
    );
  });
}

export async function clearInstagramRecoveryFailure(mediaId: string): Promise<void> {
  if (!mediaId.trim()) {
    throw new InstagramRecoveryStateError("clear");
  }
  await guard("clear", async () => {
    await documentClient.send(
      new DeleteCommand({
        TableName: TABLES.INSTAGRAM_SYNC_RECOVERY,
        Key: { pk: RECOVERY_PK, sk: failureKey(mediaId) },
      })
    );
  });
}
