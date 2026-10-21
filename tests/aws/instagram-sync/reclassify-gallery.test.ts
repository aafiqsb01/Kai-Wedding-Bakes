import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductType } from "../../../aws/config/database";
import {
  buildProductTypeUpdate,
  main,
  type GalleryScanPage,
  type ProductTypeUpdate,
  type ReclassifyClients,
  type ResolvedTarget,
  type StoredGalleryProduct,
} from "../../../aws/functions/instagram-sync/reclassify-gallery";

const TARGET: ResolvedTarget = {
  accountId: "640168417037",
  region: "eu-west-2",
  tableName: "opulence-wedding-bakes-gallery",
};

const APPLY = [
  "node",
  "reclassify-gallery.cjs",
  "--apply",
  "--expected-account",
  TARGET.accountId,
  "--expected-region",
  TARGET.region,
  "--expected-table",
  TARGET.tableName,
];

type StoredRow = StoredGalleryProduct & {
  backupUrl: string;
  likes: number;
  media?: Array<{ mediaId: string; s3Key: string; url: string }>;
  instagramTimestamp: string;
  syncedAt: string;
  productTypes?: string[];
};

function row(photoId: string, caption: string, productType: string): StoredRow {
  return {
    photoId,
    caption,
    productType,
    backupUrl: `https://bucket.example/${encodeURIComponent(photoId)}.jpg`,
    likes: 4,
    media: [
      {
        mediaId: photoId,
        s3Key: `instagram/2026/${photoId}.jpg`,
        url: `https://bucket.example/${encodeURIComponent(photoId)}.jpg`,
      },
    ],
    instagramTimestamp: "2026-09-01T00:00:00.000Z",
    syncedAt: "2026-09-02T00:00:00.000Z",
  };
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function harness(pages: StoredRow[][], target: ResolvedTarget = TARGET) {
  const store = new Map<string, StoredRow>(pages.flat().map((item) => [item.photoId as string, structuredClone(item)]));
  const updates: ProductTypeUpdate[] = [];
  const calls: string[] = [];
  const startKeys: Array<Record<string, unknown> | undefined> = [];
  let scanError: Error | null = null;
  const updateErrors = new Map<string, Error>();
  let clientsCreated = 0;

  const clients: ReclassifyClients = {
    resolveTarget: async () => {
      calls.push("resolve");
      return target;
    },
    scanPage: async (startKey) => {
      calls.push("scan");
      if (!stdout.some((line) => line.startsWith("AWS account:"))) {
        throw new Error("scan started before the resolved target was printed");
      }
      startKeys.push(startKey);
      if (scanError && startKeys.length > 1) throw scanError;
      const index = startKey ? Number(startKey.page) : 0;
      const items = (pages[index] ?? []).map((item) => {
        const stored = store.get(item.photoId as string);
        return stored
          ? {
              photoId: stored.photoId,
              caption: stored.caption,
              productType: stored.productType,
              productTypes: stored.productTypes,
            }
          : item;
      });
      const next = index + 1;
      const page: GalleryScanPage = {
        items,
        lastKey: next < pages.length ? { page: next } : undefined,
      };
      return page;
    },
    updateProductType: async (update) => {
      calls.push(`update:${update.photoId}`);
      updates.push(update);
      const failure = updateErrors.get(update.photoId);
      if (failure) throw failure;
      const current = store.get(update.photoId);
      if (!current) throw namedError("ConditionalCheckFailedException", "The conditional request failed");
      store.set(update.photoId, {
        ...current,
        productType: update.productType,
        productTypes: update.productTypes,
      });
    },
  };

  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    store,
    updates,
    calls,
    startKeys,
    stdout,
    stderr,
    failScanAfterFirstPage(error: Error) {
      scanError = error;
    },
    failUpdate(photoId: string, error: Error) {
      updateErrors.set(photoId, error);
    },
    async run(argv: string[]) {
      clientsCreated = 0;
      return main(argv, {
        createClients: async () => {
          clientsCreated += 1;
          calls.push("create");
          return clients;
        },
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      });
    },
    clientsCreated: () => clientsCreated,
  };
}

function summaryOf(stdout: string[]): Record<string, unknown> {
  const json = stdout.find((line) => line.startsWith("{"));
  assert.ok(json, "expected a JSON summary");
  return JSON.parse(json) as Record<string, unknown>;
}

describe("reclassify gallery command", () => {
  it("makes no AWS calls when no flag is provided", async () => {
    const env = harness([[row("birthday", "#birthdaycake", "wedding-cake")]]);

    const result = await env.run(["node", "reclassify-gallery.cjs"]);

    assert.equal(result.exitCode, 1);
    assert.equal(env.clientsCreated(), 0);
    assert.deepEqual(env.calls, []);
    assert.equal(result.summary, undefined);
    assert.match(env.stderr.join("\n"), /Usage/);
  });

  it("dry-run scans and does not update", async () => {
    const env = harness([[row("birthday", "#birthdaycake", "wedding-cake")]]);

    const result = await env.run(["node", "reclassify-gallery.cjs", "--dry-run"]);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.calls, ["create", "resolve", "scan"]);
    assert.deepEqual(env.updates, []);
    assert.equal(env.store.get("birthday")?.productType, "wedding-cake");
    assert.deepEqual(env.stdout.slice(0, 3), [
      "AWS account: 640168417037",
      "AWS region: eu-west-2",
      "Gallery table: opulence-wedding-bakes-gallery",
    ]);
    const summary = summaryOf(env.stdout);
    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.updated, 0);
    assert.equal(summary.planned, 1);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.changes, [
      {
        photoId: "birthday",
        added: ["celebratory-cakes"],
        removed: ["wedding-cake"],
        productTypes: ["celebratory-cakes"],
      },
    ]);
    assert.equal(env.store.get("birthday")?.productType, "wedding-cake");
  });

  it("dry-run reports cake migrations and leaves every row untouched", async () => {
    const env = harness([
      [
        row("wedding", "#weddingcake #birthdaycake", "wedding-cake"),
        row("wedding-hyphen", "Table cake #Wedding-Cake", "wedding-cake"),
        row("wedding-compound", "#elegantweddingcake #luxuryweddingcake", "wedding-cake"),
        row("cupcake", "#cupcake", "cupcakes"),
        row("cupcakes", "#customcake #cupcakes", "cupcakes"),
        row("birthday", "#birthdaycake", "birthday-cake"),
        row("nikah", "#nikah-cake", "nikah-cake"),
        row("engagement", "party #engagement", "engagement-cake"),
        row("unseen", "#christeningcake", "wedding-cake"),
        row("prose", "birthday cake with no hashtag", "anniversary-cake"),
        row("other", "#macarons", "wedding-cake"),
      ],
    ]);

    const result = await env.run(["node", "reclassify-gallery.cjs", "--dry-run"]);
    const summary = summaryOf(env.stdout);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.updates, []);
    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.updated, 0);
    assert.equal(summary.planned, 5);
    assert.equal(summary.unchanged, 4);
    assert.equal(summary.skipped, 2);
    assert.deepEqual(summary.changes, [
      {
        photoId: "wedding",
        added: ["celebratory-cakes"],
        removed: [],
        productTypes: ["wedding-cake", "celebratory-cakes"],
      },
      {
        photoId: "birthday",
        added: ["celebratory-cakes"],
        removed: ["birthday-cake"],
        productTypes: ["celebratory-cakes"],
      },
      {
        photoId: "nikah",
        added: ["celebratory-cakes"],
        removed: ["nikah-cake"],
        productTypes: ["celebratory-cakes"],
      },
      {
        photoId: "engagement",
        added: ["celebratory-cakes"],
        removed: ["engagement-cake"],
        productTypes: ["celebratory-cakes"],
      },
      {
        photoId: "unseen",
        added: ["celebratory-cakes"],
        removed: ["wedding-cake"],
        productTypes: ["celebratory-cakes"],
      },
    ]);
    assert.equal(env.store.get("wedding")?.productType, "wedding-cake");
    assert.equal(env.store.get("wedding-hyphen")?.productType, "wedding-cake");
    assert.equal(env.store.get("wedding-compound")?.productType, "wedding-cake");
    assert.equal(env.store.get("cupcake")?.productType, "cupcakes");
    assert.equal(env.store.get("cupcakes")?.productType, "cupcakes");
    assert.equal(env.store.get("birthday")?.productType, "birthday-cake");
    assert.equal(env.store.get("nikah")?.productType, "nikah-cake");
    assert.equal(env.store.get("engagement")?.productType, "engagement-cake");
    assert.equal(env.store.get("unseen")?.productType, "wedding-cake");
    assert.equal(env.store.get("prose")?.productType, "anniversary-cake");
    assert.equal(env.store.get("other")?.productType, "wedding-cake");
  });

  it("apply checks account, region and table before scanning or updating", async () => {
    const env = harness([[row("birthday", "#birthdaycake", "wedding-cake")]]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.calls, ["create", "resolve", "scan", "update:birthday"]);
    assert.ok(env.calls.indexOf("resolve") < env.calls.indexOf("scan"));
    assert.ok(env.calls.indexOf("scan") < env.calls.indexOf("update:birthday"));
    assert.equal(env.store.get("birthday")?.productType, "celebratory-cakes");
  });

  it("aborts before the first scan when the confirmed target does not match", async () => {
    const env = harness([[row("birthday", "#birthdaycake", "wedding-cake")]]);

    const result = await env.run([
      "node",
      "reclassify-gallery.cjs",
      "--apply",
      "--expected-account",
      "000000000000",
      "--expected-region",
      "us-east-1",
      "--expected-table",
      "other-gallery",
    ]);

    assert.equal(result.exitCode, 1);
    assert.deepEqual(env.calls, ["create", "resolve"]);
    assert.equal(env.calls.includes("scan"), false);
    assert.deepEqual(env.updates, []);
    assert.match(env.stderr.join("\n"), /account, region, table/);
    assert.match(env.stderr.join("\n"), /No gallery scan was started/);
    assert.deepEqual(env.stdout, [
      "AWS account: 640168417037",
      "AWS region: eu-west-2",
      "Gallery table: opulence-wedding-bakes-gallery",
    ]);
  });

  it("rejects apply when a confirmation flag is missing, before creating clients", async () => {
    const env = harness([]);

    const result = await env.run(["node", "reclassify-gallery.cjs", "--apply", "--expected-account", TARGET.accountId]);

    assert.equal(result.exitCode, 1);
    assert.equal(env.clientsCreated(), 0);
    assert.deepEqual(env.calls, []);
  });

  it("follows continuation keys through the final page", async () => {
    const env = harness([
      [row("page-1", "#birthdaycake", "wedding-cake")],
      [row("page-2", "#anniversarycake", "wedding-cake")],
    ]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.startKeys, [undefined, { page: 1 }]);
    assert.equal(result.summary?.pages, 2);
    assert.equal(result.summary?.scanned, 2);
    assert.equal(env.store.get("page-1")?.productType, "celebratory-cakes");
    assert.equal(env.store.get("page-2")?.productType, "celebratory-cakes");
  });

  it("does not downgrade unrecognised captions to wedding-cake", async () => {
    const env = harness([
      [
        row("short", "#sparklers", "cupcakes"),
        row("plain", "birthday cake", "cupcakes"),
        row("unknown", "#macarons", "cupcakes"),
        row("empty", "", "anniversary-cake"),
        row("stored-cupcakes", "cupcakes for the table", "cupcakes"),
      ],
    ]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary?.updated, 0);
    assert.equal(result.summary?.planned, 0);
    assert.equal(result.summary?.eligible, 0);
    assert.equal(result.summary?.skipped, 5);
    assert.deepEqual(env.updates, []);
    for (const item of ["short", "plain", "unknown", "stored-cupcakes"]) {
      assert.equal(env.store.get(item)?.productType, "cupcakes");
    }
    assert.equal(env.store.get("empty")?.productType, "anniversary-cake");
  });

  it("assigns every matching product type", async () => {
    const env = harness([
      [
        row("all-three", "#cupcakes #birthdaycake #weddingcake", "birthday-cake"),
        row("cupcakes-and-cake", "#anniversarycake #cupcakes", "anniversary-cake"),
        row("celebratory", "#nikahcake #engagement", "nikah-cake"),
        row("both", "#weddingcakeideas #cupcakes", "cupcakes"),
      ],
    ]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.store.get("all-three")?.productTypes, [
      "wedding-cake",
      "cupcakes",
      "celebratory-cakes",
    ]);
    assert.equal(env.store.get("all-three")?.productType, "wedding-cake");
    assert.deepEqual(env.store.get("cupcakes-and-cake")?.productTypes, ["cupcakes", "celebratory-cakes"]);
    assert.deepEqual(env.store.get("celebratory")?.productTypes, ["celebratory-cakes"]);
    assert.deepEqual(env.store.get("both")?.productTypes, ["wedding-cake", "cupcakes"]);
    assert.equal(env.store.get("both")?.productType, "wedding-cake");
    assert.deepEqual(env.updates, [
      {
        photoId: "all-three",
        productType: "wedding-cake",
        productTypes: ["wedding-cake", "cupcakes", "celebratory-cakes"],
      },
      {
        photoId: "cupcakes-and-cake",
        productType: "cupcakes",
        productTypes: ["cupcakes", "celebratory-cakes"],
      },
      {
        photoId: "celebratory",
        productType: "celebratory-cakes",
        productTypes: ["celebratory-cakes"],
      },
      {
        photoId: "both",
        productType: "wedding-cake",
        productTypes: ["wedding-cake", "cupcakes"],
      },
    ]);
  });

  it("reports a later update failure without hiding the earlier success", async () => {
    const env = harness([
      [
        row("ok", "#birthdaycake", "wedding-cake"),
        row("bad", "#anniversarycake", "wedding-cake"),
      ],
    ]);
    env.failUpdate("bad", namedError("ProvisionedThroughputExceededException", "Throughput exceeded"));

    const result = await env.run(APPLY);
    const summary = summaryOf(env.stdout);

    assert.equal(result.exitCode, 1);
    assert.equal(summary.ok, false);
    assert.equal(summary.updated, 1);
    assert.equal(env.store.get("ok")?.productType, "celebratory-cakes");
    assert.equal(env.store.get("bad")?.productType, "wedding-cake");
    assert.deepEqual(summary.failures, [
      {
        photoId: "bad",
        errorName: "ProvisionedThroughputExceededException",
        message: "Throughput exceeded",
      },
    ]);
    assert.equal(JSON.stringify(summary).includes("#anniversarycake"), false);
  });

  it("reports a conditional-check failure and still updates later rows", async () => {
    const env = harness([
      [
        row("gone", "#birthdaycake", "wedding-cake"),
        row("later", "#anniversarycake", "wedding-cake"),
      ],
    ]);
    env.failUpdate("gone", namedError("ConditionalCheckFailedException", "The conditional request failed"));

    const result = await env.run(APPLY);
    const summary = summaryOf(env.stdout);
    const failures = summary.failures as Array<{ photoId: string; errorName: string; message: string }>;

    assert.equal(result.exitCode, 1);
    assert.equal(summary.ok, false);
    assert.equal(failures[0]?.photoId, "gone");
    assert.equal(failures[0]?.errorName, "ConditionalCheckFailedException");
    assert.match(failures[0]?.message ?? "", /Later rows are still processed/);
    assert.equal(env.store.get("later")?.productType, "celebratory-cakes");
    assert.equal(env.calls.includes("update:later"), true);
  });

  it("reports a scan failure after earlier updates and exits non-zero", async () => {
    const env = harness([
      [row("ok", "#birthdaycake", "wedding-cake")],
      [row("unseen", "#anniversarycake", "wedding-cake")],
    ]);
    env.failScanAfterFirstPage(namedError("InternalServerError", "scan broke"));

    const result = await env.run(APPLY);
    const summary = summaryOf(env.stdout);
    const scanFailure = summary.scanFailure as { stage: string; errorName: string; message: string };

    assert.equal(result.exitCode, 1);
    assert.equal(summary.ok, false);
    assert.equal(summary.scanIncomplete, true);
    assert.equal(summary.updated, 1);
    assert.equal(scanFailure.stage, "scan");
    assert.equal(scanFailure.errorName, "InternalServerError");
    assert.match(scanFailure.message, /remain applied/);
    assert.equal(env.store.get("ok")?.productType, "celebratory-cakes");
    assert.equal(env.store.get("unseen")?.productType, "wedding-cake");
  });

  it("does not update a record again once its product type matches", async () => {
    const env = harness([[row("birthday", "#birthday-cake", "wedding-cake")]]);

    const first = await env.run(APPLY);
    const second = await env.run(APPLY);

    assert.equal(first.exitCode, 0);
    assert.equal(first.summary?.updated, 1);
    assert.equal(second.exitCode, 0);
    assert.equal(second.summary?.updated, 0);
    assert.equal(second.summary?.unchanged, 1);
    assert.equal(second.summary?.planned, 0);
    assert.equal(env.updates.length, 1);
    assert.equal(env.store.get("birthday")?.productType, "celebratory-cakes");
    assert.deepEqual(env.store.get("birthday")?.productTypes, ["celebratory-cakes"]);
  });

  it("makes no further changes after a multi-category apply", async () => {
    const env = harness([[row("all", "#weddingcake #cupcakes #birthdaycake #engagement", "wedding-cake")]]);

    const first = await env.run(APPLY);
    const second = await env.run(APPLY);

    assert.equal(first.exitCode, 0);
    assert.equal(first.summary?.updated, 1);
    assert.equal(first.summary?.planned, 1);
    assert.deepEqual(first.summary?.changes, [
      {
        photoId: "all",
        added: ["cupcakes", "celebratory-cakes"],
        removed: [],
        productTypes: ["wedding-cake", "cupcakes", "celebratory-cakes"],
      },
    ]);
    assert.equal(second.exitCode, 0);
    assert.equal(second.summary?.planned, 0);
    assert.equal(second.summary?.updated, 0);
    assert.equal(second.summary?.unchanged, 1);
    assert.equal(env.updates.length, 1);
    assert.equal(env.store.get("all")?.productType, "wedding-cake");
    assert.deepEqual(env.store.get("all")?.productTypes, [
      "wedding-cake",
      "cupcakes",
      "celebratory-cakes",
    ]);
  });

  it("dry-run leaves an already matching set untouched and reports crossovers", async () => {
    const matched = row("matched", "#weddingcakeideas #cupcakes", "wedding-cake");
    matched.productTypes = ["cupcakes", "wedding-cake"];
    const env = harness([
      [
        matched,
        row("sweet", "#sweetcelebrationsweddingcakes #cupcakes", "cupcakes"),
        row("ideas", "#weddingcakeideas #cupcakes", "cupcakes"),
        row("duplicate", "#Cupcakes #cupcake #CUPCAKES", "cupcakes"),
      ],
    ]);

    const result = await env.run(["node", "reclassify-gallery.cjs", "--dry-run"]);
    const summary = summaryOf(env.stdout);

    assert.equal(result.exitCode, 0);
    assert.equal(summary.updated, 0);
    assert.equal(summary.unchanged, 2);
    assert.equal(summary.planned, 2);
    assert.deepEqual(env.updates, []);
    assert.equal(env.store.get("matched")?.productType, "wedding-cake");
    assert.deepEqual(env.store.get("sweet")?.productTypes, undefined);
    assert.deepEqual(summary.changes, [
      {
        photoId: "sweet",
        added: ["wedding-cake"],
        removed: [],
        productTypes: ["wedding-cake", "cupcakes"],
      },
      {
        photoId: "ideas",
        added: ["wedding-cake"],
        removed: [],
        productTypes: ["wedding-cake", "cupcakes"],
      },
    ]);
  });

  it("updates only product membership and keeps the photoId exactly as stored", async () => {
    const photoId = " birthday ";
    const original = row(photoId, "#birthdaycake", "wedding-cake");
    const env = harness([[original]]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(env.updates, [
      { photoId, productType: "celebratory-cakes", productTypes: ["celebratory-cakes"] },
    ]);
    const stored = env.store.get(photoId);
    assert.equal(stored?.productType, "celebratory-cakes");
    assert.deepEqual(stored?.productTypes, ["celebratory-cakes"]);
    assert.equal(stored?.photoId, photoId);
    assert.equal(stored?.caption, original.caption);
    assert.equal(stored?.backupUrl, original.backupUrl);
    assert.equal(stored?.likes, original.likes);
    assert.equal(stored?.instagramTimestamp, original.instagramTimestamp);
    assert.equal(stored?.syncedAt, original.syncedAt);
    assert.deepEqual(stored?.media, original.media);

    const command = buildProductTypeUpdate(TARGET.tableName, photoId, "celebratory-cakes", ["celebratory-cakes"]);
    assert.deepEqual(command, {
      TableName: TARGET.tableName,
      Key: { photoId },
      UpdateExpression: "SET productType = :productType, productTypes = :productTypes",
      ExpressionAttributeValues: {
        ":productType": "celebratory-cakes" satisfies ProductType,
        ":productTypes": ["celebratory-cakes"] satisfies ProductType[],
      },
      ConditionExpression: "attribute_exists(photoId)",
    });
    assert.equal(JSON.stringify(command).includes("backupUrl"), false);
  });

  it("skips a missing photoId without writing", async () => {
    const env = harness([[{ ...row("ignored", "#birthdaycake", "wedding-cake"), photoId: "" }]]);

    const result = await env.run(APPLY);

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary?.invalidKeys, 1);
    assert.equal(result.summary?.skipped, 1);
    assert.equal(result.summary?.updated, 0);
    assert.deepEqual(env.updates, []);
  });

  it("does not scan when caller identity cannot be resolved", async () => {
    const env = harness([[row("birthday", "#birthdaycake", "wedding-cake")]]);
    env.calls.length = 0;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await main(["node", "reclassify-gallery.cjs", "--dry-run"], {
      createClients: async () => ({
        resolveTarget: async () => {
          throw namedError("AccessDeniedException", "not authorised");
        },
        scanPage: async () => {
          throw new Error("scan should not run");
        },
        updateProductType: async () => {
          throw new Error("update should not run");
        },
      }),
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.summary, undefined);
    assert.deepEqual(stdout, []);
    assert.match(stderr.join("\n"), /No gallery scan was started/);
    assert.match(stderr.join("\n"), /AccessDeniedException/);
  });
});
