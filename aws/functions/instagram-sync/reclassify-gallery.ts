import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ProductType } from "../../config/database";
import { recognisedProductType } from "./sync";

/**
 * One-off gallery product-type reclassification.
 *
 * Does not run from the scheduled Instagram sync handler. From the aws/ directory:
 *
 *   npm run reclassify-gallery-product-types -- --dry-run
 *   npm run reclassify-gallery-product-types -- --apply \
 *     --expected-account ACCOUNT_ID \
 *     --expected-region REGION \
 *     --expected-table TABLE_NAME
 *
 * Dry-run resolves the caller with STS, prints the account, region and table,
 * then scans. It does not update DynamoDB.
 *
 * Apply does the same, then updates productType only when the caption contains
 * a recognised product-type hashtag and the confirmed account, region and table
 * match. No account ID is built in. The operator must pass the expected value.
 */

const USAGE = [
  "Usage:",
  "  npm run reclassify-gallery-product-types -- --dry-run",
  "  npm run reclassify-gallery-product-types -- --apply --expected-account ACCOUNT_ID --expected-region REGION --expected-table TABLE_NAME",
  "",
  "--dry-run reads the caller identity and gallery table and does not write.",
  "--apply requires --expected-account, --expected-region and --expected-table.",
  "The account ID is whatever you pass. This command does not assume one.",
].join("\n");

export type StoredGalleryProduct = {
  photoId?: string;
  caption?: string;
  productType?: string;
};

export type GalleryScanPage = {
  items: StoredGalleryProduct[];
  lastKey?: Record<string, unknown>;
};

export type ProductTypeUpdate = {
  photoId: string;
  productType: ProductType;
};

export type ResolvedTarget = {
  accountId: string;
  region: string;
  tableName: string;
};

export type ReclassifyClients = {
  resolveTarget: () => Promise<ResolvedTarget>;
  scanPage: (startKey?: Record<string, unknown>) => Promise<GalleryScanPage>;
  updateProductType: (update: ProductTypeUpdate) => Promise<void>;
};

export type RowFailure = {
  photoId: string;
  errorName: string;
  message: string;
};

export type ReclassifyGallerySummary = {
  pages: number;
  scanned: number;
  eligible: number;
  unchanged: number;
  skipped: number;
  invalidKeys: number;
  planned: number;
  updated: number;
  failures: RowFailure[];
  changes: Array<{ photoId: string; from: string | undefined; to: ProductType }>;
  scanIncomplete: boolean;
  scanFailure?: { stage: "scan"; errorName: string; message: string };
};

export type ParsedReclassifyArgs =
  | { apply: false }
  | {
      apply: true;
      expectedAccount: string;
      expectedRegion: string;
      expectedTable: string;
    };

export type MainResult = {
  exitCode: number;
  target?: ResolvedTarget;
  summary?: ReclassifyGallerySummary;
};

export type MainOptions = {
  createClients?: () => Promise<ReclassifyClients>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

const CONFIRMATION_FLAGS = ["--expected-account", "--expected-region", "--expected-table"] as const;

export function buildProductTypeUpdate(
  tableName: string,
  photoId: string,
  productType: ProductType
): {
  TableName: string;
  Key: { photoId: string };
  UpdateExpression: string;
  ExpressionAttributeValues: { ":productType": ProductType };
  ConditionExpression: string;
} {
  return {
    TableName: tableName,
    Key: { photoId },
    UpdateExpression: "SET productType = :productType",
    ExpressionAttributeValues: { ":productType": productType },
    ConditionExpression: "attribute_exists(photoId)",
  };
}

export function parseReclassifyArgs(argv: string[]): ParsedReclassifyArgs {
  const args = argv.slice(2);
  let apply = false;
  let dryRun = false;
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--apply") {
      if (apply) throw new Error(USAGE);
      apply = true;
      continue;
    }
    if (token === "--dry-run") {
      if (dryRun) throw new Error(USAGE);
      dryRun = true;
      continue;
    }
    if ((CONFIRMATION_FLAGS as readonly string[]).includes(token)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--") || values.has(token)) throw new Error(USAGE);
      values.set(token, value);
      index += 1;
      continue;
    }
    throw new Error(USAGE);
  }

  if (dryRun === apply) throw new Error(USAGE);
  if (dryRun) {
    if (values.size > 0) throw new Error(USAGE);
    return { apply: false };
  }

  const expectedAccount = values.get("--expected-account");
  const expectedRegion = values.get("--expected-region");
  const expectedTable = values.get("--expected-table");
  if (!expectedAccount || !expectedRegion || !expectedTable || values.size !== 3) {
    throw new Error(USAGE);
  }
  return { apply: true, expectedAccount, expectedRegion, expectedTable };
}

function emptySummary(): ReclassifyGallerySummary {
  return {
    pages: 0,
    scanned: 0,
    eligible: 0,
    unchanged: 0,
    skipped: 0,
    invalidKeys: 0,
    planned: 0,
    updated: 0,
    failures: [],
    changes: [],
    scanIncomplete: false,
  };
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Gallery reclassification failed";
}

function updateFailure(photoId: string, error: unknown): RowFailure {
  const name = errorName(error);
  if (name === "ConditionalCheckFailedException") {
    return {
      photoId,
      errorName: name,
      message:
        "The item no longer exists. It was deleted or its key changed before the update. Later rows are still processed. Applied updates are not rolled back.",
    };
  }
  return {
    photoId,
    errorName: name,
    message: errorMessage(error),
  };
}

export function exactPhotoId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

export async function reclassifyGalleryProductTypes(
  deps: Pick<ReclassifyClients, "scanPage" | "updateProductType">,
  options: { apply: boolean }
): Promise<ReclassifyGallerySummary> {
  const summary = emptySummary();
  let startKey: Record<string, unknown> | undefined;

  do {
    let page: GalleryScanPage;
    try {
      page = await deps.scanPage(startKey);
    } catch (error) {
      summary.scanIncomplete = true;
      summary.scanFailure = {
        stage: "scan",
        errorName: errorName(error),
        message: `${errorMessage(error)} Scan stopped after ${summary.updated} successful update(s). Those updates remain applied.`,
      };
      break;
    }

    summary.pages += 1;
    for (const item of page.items) {
      summary.scanned += 1;
      const photoId = exactPhotoId(item.photoId);
      if (!photoId) {
        summary.skipped += 1;
        summary.invalidKeys += 1;
        continue;
      }

      const recognised = typeof item.caption === "string" ? recognisedProductType(item.caption) : null;
      if (!recognised) {
        summary.skipped += 1;
        continue;
      }

      summary.eligible += 1;
      const current = typeof item.productType === "string" ? item.productType : undefined;
      if (current === recognised) {
        summary.unchanged += 1;
        continue;
      }

      summary.planned += 1;
      summary.changes.push({ photoId, from: current, to: recognised });
      if (!options.apply) continue;

      try {
        await deps.updateProductType({ photoId, productType: recognised });
        summary.updated += 1;
      } catch (error) {
        summary.failures.push(updateFailure(photoId, error));
      }
    }

    startKey = page.lastKey;
  } while (startKey);

  return summary;
}

function summaryFailed(summary: ReclassifyGallerySummary): boolean {
  return summary.failures.length > 0 || summary.scanIncomplete;
}

function printSummary(
  stdout: (line: string) => void,
  mode: "dry-run" | "apply",
  target: ResolvedTarget,
  summary: ReclassifyGallerySummary
): void {
  stdout(
    JSON.stringify(
      {
        ok: !summaryFailed(summary),
        mode,
        account: target.accountId,
        region: target.region,
        table: target.tableName,
        pages: summary.pages,
        scanned: summary.scanned,
        eligible: summary.eligible,
        unchanged: summary.unchanged,
        skipped: summary.skipped,
        invalidKeys: summary.invalidKeys,
        planned: summary.planned,
        updated: summary.updated,
        scanIncomplete: summary.scanIncomplete,
        scanFailure: summary.scanFailure ?? null,
        failures: summary.failures,
        changes: summary.changes,
      },
      null,
      2
    )
  );
}

async function createProductionClients(): Promise<ReclassifyClients> {
  const { documentClient, TABLES } = await import("../../config/database");
  const region = await documentClient.config.region();
  const sts = new STSClient({ region });
  const tableName = TABLES.GALLERY;

  return {
    resolveTarget: async () => {
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      const accountId = identity.Account?.trim();
      if (!accountId) {
        throw new Error("STS GetCallerIdentity did not return an account ID");
      }
      return { accountId, region, tableName };
    },
    scanPage: async (startKey) => {
      const result = await documentClient.send(
        new ScanCommand({
          TableName: tableName,
          ProjectionExpression: "photoId, caption, productType",
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        })
      );
      return {
        items: (result.Items ?? []) as StoredGalleryProduct[],
        lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
      };
    },
    updateProductType: async (update) => {
      await documentClient.send(
        new UpdateCommand(buildProductTypeUpdate(tableName, update.photoId, update.productType))
      );
    },
  };
}

export async function main(argv: string[], options: MainOptions = {}): Promise<MainResult> {
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));

  let parsed: ParsedReclassifyArgs;
  try {
    parsed = parseReclassifyArgs(argv);
  } catch (error) {
    stderr(errorMessage(error));
    return { exitCode: 1 };
  }

  let clients: ReclassifyClients;
  try {
    clients = await (options.createClients ?? createProductionClients)();
  } catch (error) {
    stderr(`AWS client setup failed before the gallery scan: ${errorName(error)}: ${errorMessage(error)}`);
    return { exitCode: 1 };
  }

  let target: ResolvedTarget;
  try {
    target = await clients.resolveTarget();
  } catch (error) {
    stderr(
      `Caller identity could not be resolved. No gallery scan was started. ${errorName(error)}: ${errorMessage(error)}`
    );
    return { exitCode: 1 };
  }

  stdout(`AWS account: ${target.accountId}`);
  stdout(`AWS region: ${target.region}`);
  stdout(`Gallery table: ${target.tableName}`);

  if (parsed.apply) {
    const mismatches: string[] = [];
    if (target.accountId !== parsed.expectedAccount) mismatches.push("account");
    if (target.region !== parsed.expectedRegion) mismatches.push("region");
    if (target.tableName !== parsed.expectedTable) mismatches.push("table");
    if (mismatches.length > 0) {
      stderr(
        `Refusing to continue. Confirmed ${mismatches.join(", ")} did not match the resolved target. No gallery scan was started.`
      );
      return { exitCode: 1, target };
    }
  }

  const summary = await reclassifyGalleryProductTypes(clients, { apply: parsed.apply });
  printSummary(stdout, parsed.apply ? "apply" : "dry-run", target, summary);
  return { exitCode: summaryFailed(summary) ? 1 : 0, target, summary };
}

function isDirectRun(): boolean {
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return entry.endsWith("/reclassify-gallery.cjs") || entry.endsWith("/reclassify-gallery.ts");
}

if (isDirectRun()) {
  main(process.argv).then((result) => {
    process.exitCode = result.exitCode;
  });
}
