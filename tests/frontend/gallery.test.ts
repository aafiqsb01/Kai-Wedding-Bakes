import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { docClient, GALLERY_TABLE } from "../../src/lib/dynamodb";
import { getGalleryCakes } from "../../src/lib/gallery";

type ScanInput = {
  TableName?: string;
  ExclusiveStartKey?: Record<string, unknown>;
};

type ScanPage = {
  items?: Array<Record<string, unknown>>;
  lastKey?: Record<string, unknown>;
};

const originalSend = docClient.send.bind(docClient);

afterEach(() => {
  docClient.send = originalSend;
});

function stubScan(pages: ScanPage[]) {
  const inputs: ScanInput[] = [];
  docClient.send = (async (command: ScanCommand) => {
    const input = command.input as ScanInput;
    inputs.push({
      TableName: input.TableName,
      ExclusiveStartKey: input.ExclusiveStartKey,
    });
    const page = pages[inputs.length - 1];
    if (!page) {
      throw new Error("scan called more times than stubbed");
    }
    return {
      Items: page.items,
      LastEvaluatedKey: page.lastKey,
    };
  }) as typeof docClient.send;
  return inputs;
}

function item(photoId: string) {
  return {
    photoId,
    backupUrl: `https://opulence-wedding-bakes-photos.s3.eu-west-2.amazonaws.com/instagram/2026/${photoId}.jpg`,
    productType: "wedding-cake",
    caption: "kept private",
  };
}

const CLOUDFRONT = "https://d2zp5rpt2x30su.cloudfront.net";

describe("gallery image keys", () => {
  it("prefers a stored s3Key over backupUrl", async () => {
    stubScan([
      {
        items: [
          {
            photoId: "cover",
            backupUrl: "https://bucket.s3.eu-west-2.amazonaws.com/instagram/2026/wrong.jpg",
            media: [
              {
                s3Key: "instagram/2024/right.jpg",
                url: "https://bucket.s3.eu-west-2.amazonaws.com/instagram/2026/wrong.jpg",
              },
            ],
          },
        ],
      },
    ]);

    const [cake] = await getGalleryCakes();
    assert.equal(cake?.imageUrl, `${CLOUDFRONT}/instagram/2024/right.jpg`);
    assert.deepEqual(cake?.imageUrls, [`${CLOUDFRONT}/instagram/2024/right.jpg`]);
  });

  it("derives a cover from backupUrl when no s3Key is stored", async () => {
    stubScan([{ items: [item("one")] }]);

    const [cake] = await getGalleryCakes();
    assert.equal(cake?.imageUrl, `${CLOUDFRONT}/instagram/2026/one.jpg`);
    assert.equal(cake?.imageUrls, undefined);
  });

  it("uses the syncedAt year when neither s3Key nor backupUrl is available", async () => {
    stubScan([
      {
        items: [
          {
            photoId: "bare",
            syncedAt: "2025-03-01T00:00:00.000Z",
            productType: "wedding-cake",
          },
        ],
      },
    ]);

    const [cake] = await getGalleryCakes();
    assert.equal(cake?.imageUrl, `${CLOUDFRONT}/instagram/2025/bare.jpg`);
  });

  it("resolves carousel slides from s3Key, then from a media url", async () => {
    stubScan([
      {
        items: [
          {
            photoId: "album",
            mediaType: "CAROUSEL_ALBUM",
            media: [
              { s3Key: "instagram/2024/a.jpg", url: "https://bucket.example/ignored.jpg" },
              { url: "https://bucket.s3.eu-west-2.amazonaws.com/instagram/2023/b.jpg" },
              { url: "not a url" },
            ],
          },
        ],
      },
    ]);

    const [cake] = await getGalleryCakes();
    assert.deepEqual(cake?.imageUrls, [
      `${CLOUDFRONT}/instagram/2024/a.jpg`,
      `${CLOUDFRONT}/instagram/2023/b.jpg`,
    ]);
    assert.equal(cake?.imageUrl, `${CLOUDFRONT}/instagram/2024/a.jpg`);
  });
});

describe("getGalleryCakes", () => {
  it("maps a single scan page", async () => {
    const inputs = stubScan([{ items: [item("one"), { caption: "missing id" }] }]);

    const cakes = await getGalleryCakes();

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.TableName, GALLERY_TABLE);
    assert.equal(inputs[0]?.ExclusiveStartKey, undefined);
    assert.deepEqual(
      cakes.map((cake) => cake.id),
      ["one"]
    );
  });

  it("follows LastEvaluatedKey and aggregates every page", async () => {
    const firstKey = { photoId: "one" };
    const secondKey = { photoId: "two" };
    const inputs = stubScan([
      { items: [item("one")], lastKey: firstKey },
      { items: [item("two")], lastKey: secondKey },
      { items: [item("three"), { productType: "cupcakes" }] },
    ]);

    const cakes = await getGalleryCakes();

    assert.equal(inputs.length, 3);
    assert.equal(inputs[0]?.ExclusiveStartKey, undefined);
    assert.deepEqual(inputs[1]?.ExclusiveStartKey, firstKey);
    assert.deepEqual(inputs[2]?.ExclusiveStartKey, secondKey);
    assert.deepEqual(
      cakes.map((cake) => cake.id),
      ["one", "two", "three"]
    );
  });

  it("returns an empty list when the table has no items and does not log an error", async () => {
    stubScan([{ items: [] }]);
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      assert.deepEqual(await getGalleryCakes(), []);
      assert.deepEqual(errors, []);
    } finally {
      console.error = originalError;
    }
  });

  it("returns an empty list and logs only the error name when DynamoDB fails", async () => {
    const failure = new Error("photoId secret-caption credentials");
    failure.name = "AccessDeniedException";
    docClient.send = (async () => {
      throw failure;
    }) as typeof docClient.send;

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      assert.deepEqual(await getGalleryCakes(), []);
      assert.deepEqual(errors, [["Failed to load gallery items from DynamoDB", "AccessDeniedException"]]);
    } finally {
      console.error = originalError;
    }
  });
});
