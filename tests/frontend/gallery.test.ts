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
      ["both:wedding-cake", "party:celebratory-cakes"]
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

describe("Recent Commissions legacy product type", () => {
  it("keeps a multi-category post in its singular productType and leaves other types their own commission", () => {
    const mixed = cake("mixed", "wedding-cake", "2024-06-01T00:00:00.000Z");
    mixed.productTypes = ["wedding-cake", "celebratory-cakes"];
    mixed.likes = 50;
    const quieterWedding = cake("quieter", "wedding-cake", "2024-01-01T00:00:00.000Z");
    quieterWedding.likes = 1;
    const cupcake = cake("cupcake", "cupcakes", "2024-03-01T00:00:00.000Z");
    cupcake.likes = 2;
    const party = cake("party", "celebratory-cakes", "2024-02-01T00:00:00.000Z");
    party.likes = 3;

    const featured = getFeaturedCommissions([mixed, quieterWedding, cupcake, party]);

    assert.deepEqual(
      featured.map((item) => `${item.productType}:${item.id}`),
      ["wedding-cake:mixed", "celebratory-cakes:party", "cupcakes:cupcake"]
    );
    assert.equal(featured.filter((item) => item.id === "mixed").length, 1);
    assert.equal(formatProductTypeLabel(featured[0]?.productType), "Wedding Cake");
    assert.equal(formatProductTypeLabel(featured[1]?.productType), "Celebratory Cakes");
    assert.equal(formatProductTypeLabel(featured[2]?.productType), "Cupcakes");
    assert.equal(mixed.productType, "wedding-cake");
    assert.deepEqual(mixed.productTypes, ["wedding-cake", "celebratory-cakes"]);

    const sections = getGallerySections([mixed, quieterWedding, cupcake, party]);
    assert.deepEqual(
      sections.find((section) => section.productType === "wedding-cake")?.items.map((item) => item.id),
      ["mixed", "quieter"]
    );
    assert.deepEqual(
      sections.find((section) => section.productType === "celebratory-cakes")?.items.map((item) => item.id),
      ["mixed", "party"]
    );
    assert.deepEqual(
      sections.find((section) => section.productType === "cupcakes")?.items.map((item) => item.id),
      ["cupcake"]
    );
  });

  it("selects the most-liked post per product type and breaks ties with the newer post", () => {
    const olderLikedLess = cake("older", "wedding-cake", "2024-01-01T00:00:00.000Z");
    olderLikedLess.likes = 10;
    const mostLiked = cake("liked", "wedding-cake", "2023-01-01T00:00:00.000Z");
    mostLiked.likes = 21;
    const tiedOlder = cake("tied-older", "cupcakes", "2024-01-01T00:00:00.000Z");
    tiedOlder.likes = 5;
    tiedOlder.syncedAt = "2026-01-01T00:00:00.000Z";
    const tiedNewer = cake("tied-newer", "cupcakes", "2024-08-01T00:00:00.000Z");
    tiedNewer.likes = 5;
    tiedNewer.syncedAt = "2020-01-01T00:00:00.000Z";
    const hidden = cake("hidden", "other-fun-bakes", "2024-09-01T00:00:00.000Z");
    hidden.likes = 100;
    hidden.imageUrl = "";
    const bake = cake("bake", "other-fun-bakes", "2024-02-01T00:00:00.000Z");
    bake.likes = 1;
    const sameTypeDifferentCase = cake("cased", "Wedding-Cake", "2024-07-01T00:00:00.000Z");
    sameTypeDifferentCase.likes = 20;

    const featured = getFeaturedCommissions([
      olderLikedLess,
      mostLiked,
      tiedOlder,
      tiedNewer,
      hidden,
      bake,
      sameTypeDifferentCase,
    ]);

    assert.deepEqual(
      featured.map((item) => `${item.id}:${item.likes}`),
      ["liked:21", "tied-newer:5", "bake:1"]
    );
    assert.equal(featured[0]?.productType, "wedding-cake");
    assert.equal(featured.some((item) => item.id === "cased"), false);
    assert.equal(formatProductTypeLabel(featured[2]?.productType), "Other Fun Bakes");
  });

  it("ranks product types by the winning post's likes and keeps the selection in memory", () => {
    let dynamoCalls = 0;
    docClient.send = (async () => {
      dynamoCalls += 1;
      throw new Error("DynamoDB should not be called");
    }) as typeof docClient.send;

    const cakes = [
      cake("wedding", "wedding-cake", "2024-01-01T00:00:00.000Z"),
      cake("cupcakes", "cupcakes", "2024-01-02T00:00:00.000Z"),
      cake("party", "celebratory-cakes", "2024-01-03T00:00:00.000Z"),
      cake("bake", "other-fun-bakes", "2024-01-04T00:00:00.000Z"),
      cake("nikah", "nikah-cake", "2024-01-05T00:00:00.000Z"),
      cake("engagement", "engagement-cake", "2024-01-06T00:00:00.000Z"),
    ];
    cakes[0]!.likes = 1;
    cakes[1]!.likes = 6;
    cakes[2]!.likes = 5;
    cakes[3]!.likes = 4;
    cakes[4]!.likes = 3;
    cakes[5]!.likes = 2;
    const multi = cakes[0]!;
    multi.productTypes = ["wedding-cake", "celebratory-cakes"];

    const featured = getFeaturedCommissions(cakes);

    assert.equal(dynamoCalls, 0);
    assert.equal(multi.productType, "wedding-cake");
    assert.deepEqual(multi.productTypes, ["wedding-cake", "celebratory-cakes"]);
    assert.deepEqual(
      featured.map((item) => item.id),
      ["cupcakes", "party", "bake", "nikah", "engagement"]
    );
    assert.equal(featured.some((item) => item.id === "wedding"), false);
  });
});

describe("Recent Commissions legacy occasion hashtags", () => {
  it("recovers birthday, anniversary and nikkah from exact celebratory hashtags", () => {
    const birthday = cake("birthday", "celebratory-cakes", "2024-01-01T00:00:00.000Z");
    birthday.description = "A day to remember #birthdaycake";
    birthday.productTypes = ["celebratory-cakes"];
    const anniversary = cake("anniversary", "celebratory-cakes", "2024-02-01T00:00:00.000Z");
    anniversary.description = "#anniversarycake";
    anniversary.productTypes = ["celebratory-cakes"];
    const nikah = cake("nikah", "celebratory-cakes", "2024-03-01T00:00:00.000Z");
    nikah.description = "#nikahcake";
    nikah.productTypes = ["celebratory-cakes"];

    const featured = getFeaturedCommissions([birthday, anniversary, nikah]);

    assert.deepEqual(
      featured.map((item) => `${item.id}:${formatProductTypeLabel(item.productType)}`),
      [
        "nikah:Nikkah Cake",
        "anniversary:Anniversary Cake",
        "birthday:Birthday Cake",
      ]
    );
    assert.equal(birthday.productType, "celebratory-cakes");
    assert.deepEqual(birthday.productTypes, ["celebratory-cakes"]);
    assert.equal(anniversary.productType, "celebratory-cakes");
    assert.equal(nikah.productType, "celebratory-cakes");
    assert.notEqual(featured.find((item) => item.id === "birthday"), birthday);
  });

  it("matches complete hashtags case-insensitively and keeps the first legacy match", () => {
    const cased = cake("cased", "celebratory-cakes", "2024-04-01T00:00:00.000Z");
    cased.description = "See #NiKaHcAkE today";
    const hyphenated = cake("hyphen", "celebratory-cakes", "2024-03-01T00:00:00.000Z");
    hyphenated.description = "#anniversary-cake";
    const nikkahSpelling = cake("spelling", "celebratory-cakes", "2024-02-01T00:00:00.000Z");
    nikkahSpelling.description = "#nikkahcake";
    const nikkahHyphen = cake("nikkah-hyphen", "celebratory-cakes", "2024-02-02T00:00:00.000Z");
    nikkahHyphen.description = "#nikkah-cake";
    const plural = cake("plural", "celebratory-cakes", "2024-01-01T00:00:00.000Z");
    plural.description = "#birthdaycakes #luxurybirthdaycake";
    const earlierCupcakes = cake("earlier", "celebratory-cakes", "2024-05-01T00:00:00.000Z");
    earlierCupcakes.description = "#cupcakes #birthdaycake";
    const earlierEngagement = cake("earlier-engagement", "celebratory-cakes", "2024-06-01T00:00:00.000Z");
    earlierEngagement.description = "#engagement #birthdaycake";

    function labelFor(item: Cake): string {
      const featured = getFeaturedCommissions([item]);
      return `${featured[0]?.id}:${formatProductTypeLabel(featured[0]?.productType)}`;
    }

    assert.equal(labelFor(cased), "cased:Nikkah Cake");
    assert.equal(labelFor(hyphenated), "hyphen:Anniversary Cake");
    assert.equal(labelFor(nikkahSpelling), "spelling:Nikkah Cake");
    assert.equal(labelFor(nikkahHyphen), "nikkah-hyphen:Nikkah Cake");
    assert.equal(labelFor(plural), "plural:Celebratory Cakes");
    assert.equal(labelFor(earlierCupcakes), "earlier:Celebratory Cakes");
    assert.equal(labelFor(earlierEngagement), "earlier-engagement:Celebratory Cakes");
  });

  it("leaves a celebratory post without a legacy occasion hashtag unchanged", () => {
    const plain = cake("plain", "celebratory-cakes", "2024-01-01T00:00:00.000Z");
    plain.description = "#umrahmubarak #customcakes";
    plain.productTypes = ["celebratory-cakes"];
    const before = {
      productType: plain.productType,
      productTypes: plain.productTypes,
      description: plain.description,
    };

    const featured = getFeaturedCommissions([plain]);

    assert.equal(featured[0], plain);
    assert.equal(formatProductTypeLabel(featured[0]?.productType), "Celebratory Cakes");
    assert.equal(plain.productType, before.productType);
    assert.equal(plain.productTypes, before.productTypes);
    assert.equal(plain.description, before.description);
  });

  it("keeps a wedding post in Wedding Cake when it also belongs to cupcakes", () => {
    const wedding = cake("wedding", "wedding-cake", "2024-06-01T00:00:00.000Z");
    wedding.description = "#cupcakes #birthdaycake";
    wedding.productTypes = ["wedding-cake", "cupcakes"];
    wedding.likes = 9;

    const featured = getFeaturedCommissions([wedding]);
    const sections = getGallerySections([wedding]);

    assert.equal(featured.length, 1);
    assert.equal(featured[0], wedding);
    assert.equal(formatProductTypeLabel(featured[0]?.productType), "Wedding Cake");
    assert.equal(wedding.productType, "wedding-cake");
    assert.deepEqual(wedding.productTypes, ["wedding-cake", "cupcakes"]);
    assert.deepEqual(
      sections.find((section) => section.productType === "wedding-cake")?.items.map((item) => item.id),
      ["wedding"]
    );
    assert.deepEqual(
      sections.find((section) => section.productType === "cupcakes")?.items.map((item) => item.id),
      ["wedding"]
    );
    assert.equal(
      sections.some((section) => section.productType === "birthday-cake"),
      false
    );
  });

  it("keeps a cupcakes post as Cupcakes when its caption has a birthday hashtag", () => {
    const cupcakes = cake("cupcakes", "cupcakes", "2024-03-01T00:00:00.000Z");
    cupcakes.description = "#birthdaycake";
    cupcakes.productTypes = ["cupcakes"];
    const productTypes = cupcakes.productTypes;

    const featured = getFeaturedCommissions([cupcakes]);

    assert.equal(featured[0], cupcakes);
    assert.equal(formatProductTypeLabel(featured[0]?.productType), "Cupcakes");
    assert.equal(cupcakes.productType, "cupcakes");
    assert.equal(cupcakes.productTypes, productTypes);
    assert.deepEqual(cupcakes.productTypes, ["cupcakes"]);
    assert.equal(cupcakes.description, "#birthdaycake");
  });

  it("picks the most-liked post in each derived category and orders the winners by likes", () => {
    const birthdayOlder = cake("birthday-older", "celebratory-cakes", "2020-01-01T00:00:00.000Z");
    birthdayOlder.description = "#birthdaycake";
    birthdayOlder.likes = 40;
    birthdayOlder.syncedAt = "2030-01-01T00:00:00.000Z";
    const birthdayNewer = cake("birthday-newer", "celebratory-cakes", "2024-01-01T00:00:00.000Z");
    birthdayNewer.description = "#birthday-cake";
    birthdayNewer.likes = 40;
    birthdayNewer.syncedAt = "2019-01-01T00:00:00.000Z";
    const birthdayLess = cake("birthday-less", "celebratory-cakes", "2025-01-01T00:00:00.000Z");
    birthdayLess.description = "#birthdaycake";
    birthdayLess.likes = 12;
    const anniversary = cake("anniversary", "celebratory-cakes", "2024-02-01T00:00:00.000Z");
    anniversary.description = "#anniversarycake";
    anniversary.likes = 30;
    const wedding = cake("wedding", "wedding-cake", "2024-03-01T00:00:00.000Z");
    wedding.likes = 20;
    const cupcakes = cake("cupcakes", "cupcakes", "2024-04-01T00:00:00.000Z");
    cupcakes.likes = 10;
    const nikah = cake("nikah", "celebratory-cakes", "2024-05-01T00:00:00.000Z");
    nikah.description = "#nikahcake";
    nikah.likes = 5;
    const plain = cake("plain", "celebratory-cakes", "2024-06-01T00:00:00.000Z");
    plain.description = "#cakes";
    plain.likes = 1;
    const inputs = [birthdayOlder, birthdayNewer, birthdayLess, anniversary, wedding, cupcakes, nikah, plain];
    const snapshot = inputs.map((item) => ({
      id: item.id,
      productType: item.productType,
      productTypes: item.productTypes,
      description: item.description,
      likes: item.likes,
    }));

    const featured = getFeaturedCommissions(inputs);

    assert.deepEqual(
      featured.map((item) => `${item.productType}:${item.id}`),
      [
        "birthday-cake:birthday-newer",
        "anniversary-cake:anniversary",
        "wedding-cake:wedding",
        "cupcakes:cupcakes",
        "nikah-cake:nikah",
      ]
    );
    assert.equal(featured.some((item) => item.id === "plain"), false);
    assert.equal(featured.some((item) => item.id === "birthday-older"), false);
    assert.deepEqual(
      inputs.map((item) => ({
        id: item.id,
        productType: item.productType,
        productTypes: item.productTypes,
        description: item.description,
        likes: item.likes,
      })),
      snapshot
    );

    const multi = cake("multi", "celebratory-cakes", "2024-07-01T00:00:00.000Z");
    multi.description = "#birthdaycake";
    multi.productTypes = ["celebratory-cakes", "cupcakes"];
    const sections = getGallerySections([multi]);
    assert.deepEqual(
      sections.find((section) => section.productType === "celebratory-cakes")?.items.map((item) => item.id),
      ["multi"]
    );
    assert.deepEqual(
      sections.find((section) => section.productType === "cupcakes")?.items.map((item) => item.id),
      ["multi"]
    );
    assert.equal(getFeaturedCommissions([multi])[0]?.productType, "birthday-cake");
    assert.equal(multi.productType, "celebratory-cakes");
    assert.deepEqual(multi.productTypes, ["celebratory-cakes", "cupcakes"]);
  });
});
