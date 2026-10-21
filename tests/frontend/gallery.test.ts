import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { docClient, GALLERY_TABLE } from "../../src/lib/dynamodb";
import { getGalleryCakes } from "../../src/lib/gallery";
import { getFeaturedCommissions, getGallerySections } from "../../src/lib/gallery-helpers";
import { formatProductTypeLabel } from "../../src/lib/product-type";
import type { Cake } from "../../src/types";

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

function cake(
  id: string,
  productType: string,
  instagramTimestamp: string
): Cake {
  return {
    id,
    title: productType,
    category: "wedding cake",
    imageUrl: `https://example.com/${id}.jpg`,
    description: "",
    tags: [],
    productType,
    instagramTimestamp,
  };
}

describe("getGallerySections product type order", () => {
  it("orders product types by item count descending, using the full count", () => {
    const cakes = [
      cake("c1", "cupcakes", "2024-01-01T00:00:00.000Z"),
      cake("w1", "wedding-cake", "2020-01-01T00:00:00.000Z"),
      cake("w2", "wedding-cake", "2020-01-02T00:00:00.000Z"),
      cake("w3", "wedding-cake", "2020-01-03T00:00:00.000Z"),
      cake("b1", "birthday-cake", "2026-06-01T00:00:00.000Z"),
      cake("c2", "cupcakes", "2024-02-01T00:00:00.000Z"),
    ];

    const sections = getGallerySections(cakes, 2);

    assert.deepEqual(
      sections.map((section) => section.productType),
      ["wedding-cake", "cupcakes", "birthday-cake"]
    );
    assert.deepEqual(
      sections.map((section) => section.items.map((item) => item.id)),
      [
        ["w3", "w2"],
        ["c2", "c1"],
        ["b1"],
      ]
    );
  });

  it("keeps the previous order when two product types have the same count", () => {
    const cakes = [
      cake("a1", "anniversary-cake", "2024-01-01T00:00:00.000Z"),
      cake("e1", "engagement-cake", "2025-01-01T00:00:00.000Z"),
      cake("a2", "anniversary-cake", "2023-01-01T00:00:00.000Z"),
      cake("e2", "engagement-cake", "2022-01-01T00:00:00.000Z"),
    ];

    const sections = getGallerySections(cakes);

    assert.deepEqual(
      sections.map((section) => section.productType),
      ["engagement-cake", "anniversary-cake"]
    );
  });

  it("keeps first-seen order when counts and latest timestamps match", () => {
    const sameTime = "2024-05-01T00:00:00.000Z";
    const cakes = [
      cake("n1", "nikah-cake", sameTime),
      cake("b1", "birthday-cake", sameTime),
    ];

    const sections = getGallerySections(cakes);

    assert.deepEqual(
      sections.map((section) => section.productType),
      ["nikah-cake", "birthday-cake"]
    );
  });

  it("labels celebratory cakes for the gallery", () => {
    assert.equal(formatProductTypeLabel("celebratory-cakes"), "Celebratory Cakes");

    const sections = getGallerySections([
      cake("c1", "celebratory-cakes", "2024-01-01T00:00:00.000Z"),
    ]);

    assert.equal(sections[0]?.productType, "celebratory-cakes");
    assert.equal(sections[0]?.label, "Celebratory Cakes");
  });

  it("labels other fun bakes in the same gallery section shape", () => {
    assert.equal(formatProductTypeLabel("other-fun-bakes"), "Other Fun Bakes");

    const sections = getGallerySections([
      cake("bake", "other-fun-bakes", "2024-03-01T00:00:00.000Z"),
    ]);

    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.productType, "other-fun-bakes");
    assert.equal(sections[0]?.label, "Other Fun Bakes");
    assert.equal(sections[0]?.items[0]?.id, "bake");
    assert.equal(sections[0]?.items[0]?.imageUrl, "https://example.com/bake.jpg");
  });

  it("places one post in each of its categories without duplicating it inside a category", () => {
    const both = cake("both", "wedding-cake", "2024-06-01T00:00:00.000Z");
    both.productTypes = ["wedding-cake", "cupcakes", "wedding-cake"];
    both.likes = 9;
    const party = cake("party", "celebratory-cakes", "2024-05-01T00:00:00.000Z");

    const sections = getGallerySections([both, both, party]);
    const wedding = sections.find((section) => section.productType === "wedding-cake");
    const cupcakes = sections.find((section) => section.productType === "cupcakes");
    const celebratory = sections.find((section) => section.productType === "celebratory-cakes");

    assert.deepEqual(wedding?.items.map((item) => item.id), ["both"]);
    assert.deepEqual(cupcakes?.items.map((item) => item.id), ["both"]);
    assert.deepEqual(celebratory?.items.map((item) => item.id), ["party"]);

    const featured = getFeaturedCommissions([both, party]);
    assert.deepEqual(
      featured.map((item) => `${item.id}:${item.productType}`),
      ["both:wedding-cake", "both:cupcakes", "party:celebratory-cakes"]
    );
  });

  it("keeps every category combination and legacy rows, once per section", () => {
    const at = "2024-01-01T00:00:00.000Z";
    const wedding = cake("wedding", "wedding-cake", at);
    const cupcakesOnly = cake("cupcakes", "cupcakes", at);
    const celebratory = cake("celebratory", "celebratory-cakes", at);
    const weddingCupcakes = cake("wedding-cupcakes", "wedding-cake", at);
    weddingCupcakes.productTypes = ["wedding-cake", "cupcakes"];
    const weddingCelebratory = cake("wedding-celebratory", "wedding-cake", at);
    weddingCelebratory.productTypes = ["wedding-cake", "celebratory-cakes"];
    const cupcakesCelebratory = cake("cupcakes-celebratory", "cupcakes", at);
    cupcakesCelebratory.productTypes = ["cupcakes", "celebratory-cakes"];
    const all = cake("all", "wedding-cake", at);
    all.productTypes = ["wedding-cake", "cupcakes", "celebratory-cakes", "cupcakes"];
    const legacy = cake("legacy", "birthday-cake", at);
    const emptyList = cake("empty-list", "anniversary-cake", at);
    emptyList.productTypes = [];
    const primaryDisagrees = cake("primary-disagrees", "cupcakes", at);
    primaryDisagrees.productTypes = ["wedding-cake"];

    const sections = getGallerySections([
      wedding,
      cupcakesOnly,
      celebratory,
      weddingCupcakes,
      weddingCelebratory,
      cupcakesCelebratory,
      all,
      all,
      legacy,
      emptyList,
      primaryDisagrees,
    ]);

    function ids(productType: string): string[] {
      return (
        sections.find((section) => section.productType === productType)?.items.map((item) => item.id) ?? []
      ).slice().sort();
    }

    for (const section of sections) {
      const seen = new Set<string>();
      for (const item of section.items) {
        assert.equal(seen.has(item.id), false, `${item.id} duplicated in ${section.productType}`);
        seen.add(item.id);
      }
    }

    assert.deepEqual(ids("wedding-cake"), [
      "all",
      "primary-disagrees",
      "wedding",
      "wedding-celebratory",
      "wedding-cupcakes",
    ]);
    assert.deepEqual(ids("cupcakes"), [
      "all",
      "cupcakes",
      "cupcakes-celebratory",
      "wedding-cupcakes",
    ]);
    assert.deepEqual(ids("celebratory-cakes"), [
      "all",
      "celebratory",
      "cupcakes-celebratory",
      "wedding-celebratory",
    ]);
    assert.deepEqual(ids("birthday-cake"), ["legacy"]);
    assert.deepEqual(ids("anniversary-cake"), ["empty-list"]);
    assert.equal(ids("cupcakes").includes("primary-disagrees"), false);

    const disagreed = sections
      .find((section) => section.productType === "wedding-cake")
      ?.items.find((item) => item.id === "primary-disagrees");
    assert.equal(disagreed?.productType, "cupcakes");
    assert.deepEqual(disagreed?.productTypes, ["wedding-cake"]);

    const featured = getFeaturedCommissions([
      wedding,
      cupcakesOnly,
      celebratory,
      weddingCupcakes,
      all,
      legacy,
      emptyList,
    ]);
    const featuredKeys = featured.map((item) => `${item.productType}:${item.id}`);
    assert.equal(new Set(featuredKeys).size, featuredKeys.length);
  });

  it("reads productTypes from a gallery row and still accepts a single productType", async () => {
    stubScan([
      {
        items: [
          {
            ...item("multi"),
            productType: "wedding-cake",
            productTypes: ["wedding-cake", "cupcakes", "wedding-cake"],
          },
          item("legacy"),
        ],
      },
    ]);

    const cakes = await getGalleryCakes();
    assert.deepEqual(cakes[0]?.productTypes, ["wedding-cake", "cupcakes"]);
    assert.equal(cakes[0]?.productType, "wedding-cake");
    assert.equal(cakes[1]?.productTypes, undefined);
    assert.equal(cakes[1]?.productType, "wedding-cake");

    const sections = getGallerySections(cakes);
    assert.deepEqual(
      sections.find((section) => section.productType === "cupcakes")?.items.map((entry) => entry.id),
      ["multi"]
    );
    assert.deepEqual(
      sections.find((section) => section.productType === "wedding-cake")?.items.map((entry) => entry.id),
      ["multi", "legacy"]
    );
  });

  it("does not drop a row when productTypes is empty, and lets productTypes override the primary", async () => {
    stubScan([
      {
        items: [
          { ...item("legacy"), productType: "cupcakes" },
          { ...item("empty"), productType: "wedding-cake", productTypes: [] },
          {
            ...item("override"),
            productType: "cupcakes",
            productTypes: ["wedding-cake", "celebratory-cakes"],
          },
        ],
      },
    ]);

    const cakes = await getGalleryCakes();
    assert.equal(cakes.map((entry) => entry.id).join(","), "legacy,empty,override");
    assert.equal(cakes[0]?.productTypes, undefined);
    assert.equal(cakes[0]?.productType, "cupcakes");
    assert.equal(cakes[1]?.productTypes, undefined);
    assert.equal(cakes[1]?.productType, "wedding-cake");
    assert.equal(cakes[2]?.productType, "cupcakes");
    assert.deepEqual(cakes[2]?.productTypes, ["wedding-cake", "celebratory-cakes"]);

    const sections = getGallerySections(cakes);
    function ids(productType: string): string[] {
      return sections.find((section) => section.productType === productType)?.items.map((entry) => entry.id) ?? [];
    }
    assert.deepEqual(ids("cupcakes"), ["legacy"]);
    assert.deepEqual(ids("wedding-cake"), ["empty", "override"]);
    assert.deepEqual(ids("celebratory-cakes"), ["override"]);
  });

  it("omits product types that have no gallery items", () => {
    const sections = getGallerySections([
      cake("w1", "wedding-cake", "2024-01-01T00:00:00.000Z"),
    ]);

    assert.deepEqual(
      sections.map((section) => section.productType),
      ["wedding-cake"]
    );
    assert.equal(
      sections.some((section) => section.items.length === 0),
      false
    );
  });
});
