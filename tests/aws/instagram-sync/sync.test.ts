import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoGalleryItem } from "../../../aws/config/database";
import { parseGraphError } from "../../../aws/functions/instagram-sync/graph-error";
import { isRefreshEligible, parseStoredToken } from "../../../aws/functions/instagram-sync/token-lifecycle";
import {
  DEFAULT_BACKFILL_UNTIL,
  emptyBackfill,
  parseRecoveryItems,
  failureRecord,
  recoveryRecord,
  watermarkRecord,
} from "../../../aws/functions/instagram-sync/recovery-state";
import {
  classificationForGalleryItem,
  mapToProductType,
  mapToProductTypes,
  productTypeForHashtag,
  recognisedProductType,
  recognisedProductTypes,
  runInstagramSync,
  type GraphResponse,
  type SyncDependencies,
} from "../../../aws/functions/instagram-sync/sync";

const ACCOUNT_ID = "17841400000000000";
const BOUNDARY = "2026-09-28T16:53:07+0000";
const RAW_TOKEN = "raw-token-value";
const REFRESHED_TOKEN = "refreshed-token-value";

type Call = { pathname: string; after: string | null };

function jsonResponse(status: number, body: unknown): GraphResponse {
  const text = JSON.stringify(body);
  return {
    status,
    text: async () => text,
    arrayBuffer: async () => Buffer.from(text).buffer.slice(0),
  };
}

function imageResponse(): GraphResponse {
  const bytes = Buffer.from("image");
  return {
    status: 200,
    text: async () => "",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function media(id: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    media_type: "IMAGE",
    media_url: `https://cdn.example/${id}.jpg`,
    caption: "#weddingcake",
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp,
    like_count: 1,
    ...extra,
  };
}

function harness(options: {
  secret?: string;
  boundary?: string | null;
  now?: Date;
  maxPages?: number;
  routes: (call: Call, accessToken: string) => GraphResponse;
  failSecretWrite?: boolean;
  failRecoveryRead?: boolean;
  failWatermarkInit?: boolean;
  failRecordFailure?: boolean;
  failClearFailure?: boolean;
  failAdvanceWatermark?: boolean;
  failContinuationWrite?: boolean;
  backfillUntil?: string;
  me?: GraphResponse;
}) {
  const calls: Call[] = [];
  const refreshCalls: string[] = [];
  const store = new Map<string, DynamoGalleryItem>();
  const existing: DynamoGalleryItem = {
    photoId: "existing-post",
    backupUrl: "https://example.com/existing.jpg",
    instagramUrl: "https://www.instagram.com/p/existing/",
    caption: "kept",
    productType: "wedding-cake",
    likes: 3,
    syncedAt: "2026-09-29T12:13:31.000Z",
    instagramTimestamp: options.boundary === undefined ? BOUNDARY : options.boundary ?? undefined,
  };
  store.set(existing.photoId, existing);
  let secret = options.secret ?? RAW_TOKEN;
  let metricWrites = 0;
  let saveAttempts = 0;
  let mediaUsedRefreshedToken = false;
  const uploads: string[] = [];
  const recovery = {
    initialised: false,
    position: emptyBackfill(options.backfillUntil ?? DEFAULT_BACKFILL_UNTIL),
    failures: new Map<string, string | undefined>(),
  };

  const deps: SyncDependencies = {
    fetch: async (url) => {
      const parsed = new URL(url);
      const call = { pathname: parsed.pathname, after: parsed.searchParams.get("after") };
      calls.push(call);
      if (parsed.pathname === "/refresh_access_token") {
        refreshCalls.push(parsed.pathname);
      }
      if (parsed.pathname.endsWith("/media") && parsed.searchParams.get("access_token") === REFRESHED_TOKEN) {
        mediaUsedRefreshedToken = true;
      }
      if (parsed.hostname !== "graph.instagram.com") return imageResponse();
      if (parsed.pathname === "/v18.0/me") {
        return options.me ?? jsonResponse(200, { id: ACCOUNT_ID });
      }
      return options.routes(call, parsed.searchParams.get("access_token") ?? "");
    },
    loadSecret: async () => secret,
    saveSecret: async (value) => {
      saveAttempts += 1;
      if (options.failSecretWrite) {
        throw new Error("AccessDeniedException");
      }
      if (!value.trim()) throw new Error("empty");
      secret = value;
    },
    getAccountId: () => ACCOUNT_ID,
    backfillUntil: options.backfillUntil ?? DEFAULT_BACKFILL_UNTIL,
    loadRecoveryState: async () => {
      if (options.failRecoveryRead) throw new Error("Failed to read Instagram sync recovery state");
      return {
        ...recovery.position,
        initialised: recovery.initialised,
        failures: [...recovery.failures.entries()].map(([mediaId, instagramTimestamp]) => ({
          mediaId,
          instagramTimestamp,
        })),
      };
    },
    initialiseRecovery: async (position) => {
      if (options.failWatermarkInit) {
        throw new Error("Failed to initialise Instagram sync recovery state");
      }
      recovery.initialised = true;
      recovery.position = { ...position };
    },
    saveRecovery: async (position) => {
      if (options.failContinuationWrite && position.resumeCursor) {
        throw new Error("Failed to save Instagram sync continuation");
      }
      if (options.failAdvanceWatermark && position.phase === "live") {
        throw new Error("Failed to advance Instagram sync recovery state");
      }
      recovery.initialised = true;
      recovery.position = { ...position };
    },
    recordFailure: async (mediaId, instagramTimestamp) => {
      if (options.failRecordFailure) {
        throw new Error("Failed to record Instagram sync recovery state");
      }
      recovery.failures.set(mediaId, instagramTimestamp);
    },
    clearFailure: async (mediaId) => {
      if (options.failClearFailure) {
        throw new Error("Failed to clear Instagram sync recovery state");
      }
      recovery.failures.delete(mediaId);
    },
    saveGalleryItem: async (item) => {
      store.set(item.photoId, item);
    },
    loadGalleryItem: async (photoId) => store.get(photoId),
    uploadPhoto: async (photoId) => {
      uploads.push(photoId);
      return {
        key: `instagram/2024/${photoId}.jpg`,
        url: `https://bucket.example/${photoId}.jpg`,
      };
    },
    putSuccessMetric: async () => {
      metricWrites += 1;
    },
    now: () => options.now ?? new Date("2026-10-17T12:00:00.000Z"),
    maxPages: options.maxPages ?? 10,
  };

  return {
    deps,
    calls,
    refreshCalls,
    store,
    existing,
    metricWrites: () => metricWrites,
    uploads: () => uploads,
    saveAttempts: () => saveAttempts,
    secret: () => secret,
    mediaUsedRefreshedToken: () => mediaUsedRefreshedToken,
    recovery,
  };
}

const revokedBody = {
  error: {
    message:
      "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons. access_token=LEAKED-TOKEN-VALUE",
    type: "OAuthException",
    code: 190,
  },
};

describe("product types", () => {
  it("classifies hashtags that contain both wedding and cake as wedding cakes", () => {
    for (const tag of [
      "#weddingcake",
      "#wedding-cake",
      "#weddingcakes",
      "#wedding-cakes",
      "#elegantweddingcake",
      "#royalweddingcake",
      "#weddingcakedesigner",
      "#opulenceweddingcakes",
      "#luxuryweddingcake",
      "#floralweddingcake",
      "#luxury-wedding-cake",
    ]) {
      assert.equal(mapToProductType(tag), "wedding-cake", tag);
      assert.equal(productTypeForHashtag(tag), "wedding-cake", tag);
      assert.equal(productTypeForHashtag(tag.slice(1)), "wedding-cake", tag);
    }

    assert.equal(mapToProductType("#WeddingCake extra"), "wedding-cake");
    assert.equal(mapToProductType("#Wedding-Cake"), "wedding-cake");
    assert.equal(mapToProductType("#ELEGANTWEDDINGCAKE"), "wedding-cake");
    assert.equal(mapToProductType("Show piece #LuxuryWeddingCake."), "wedding-cake");
    assert.equal(productTypeForHashtag("OpulenceWeddingCakes"), "wedding-cake");
    assert.equal(productTypeForHashtag("#wedding_cake"), "wedding-cake");
    assert.equal(productTypeForHashtag("#wedding-day-cake"), "wedding-cake");
    assert.equal(productTypeForHashtag("#weddingexhibition"), null);
    assert.equal(productTypeForHashtag("#weddingshow"), null);
    assert.equal(productTypeForHashtag("#weddingday"), null);
    assert.deepEqual(mapToProductTypes("#weddingexhibition #weddingshow"), []);
    assert.equal(mapToProductType("#cupcake"), "cupcakes");
    assert.equal(mapToProductType("#cupcakes"), "cupcakes");
    assert.equal(mapToProductType("#CUPCAKES"), "cupcakes");
    assert.equal(productTypeForHashtag("cupcake"), "cupcakes");
    assert.equal(productTypeForHashtag("#cupcakes"), "cupcakes");
  });

  it("classifies hashtags containing cupcake as cupcakes, after wedding cake", () => {
    for (const tag of [
      "#cupcake",
      "#cupcakes",
      "#CUPCAKE",
      "#celebrationcupcakes",
      "#cupcakebundle",
      "#flavouredcupcakes",
      "#themedcupcakes",
      "#VanillaCupcakes",
      "#birthdaycupcakes",
    ]) {
      assert.equal(productTypeForHashtag(tag), "cupcakes", tag);
      assert.equal(productTypeForHashtag(tag.slice(1)), "cupcakes", tag);
      assert.equal(mapToProductType(tag), "cupcakes", tag);
    }

    assert.equal(productTypeForHashtag("#cup-cake"), "cupcakes");
    assert.equal(productTypeForHashtag("#cup-cakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#wedding-cupcakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#weddingcupcakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#weddingcakecupcakes"), "wedding-cake");
    assert.equal(mapToProductType("#weddingcakecupcakes"), "wedding-cake");
    assert.equal(productTypeForHashtag("#birthdaycupcakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#sweetcelebrationsweddingcakes"), "wedding-cake");
    assert.deepEqual(recognisedProductTypes("#celebrationcupcakes #cupcakes"), ["cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#VanillaCupcakes #birthdaycake"), [
      "cupcakes",
      "celebratory-cakes",
    ]);
    assert.deepEqual(recognisedProductTypes("#weddingcupcakes #flavouredcupcakes"), ["cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#weddingcake #flavouredcupcakes"), [
      "wedding-cake",
      "cupcakes",
    ]);
    assert.equal(productTypeForHashtag("#cakemaker"), null);
    assert.equal(productTypeForHashtag("#bluecake"), null);
    assert.deepEqual(
      recognisedProductTypes("#birthdaycupcakes #cupcakes #cakemaker #bluecake"),
      ["cupcakes"]
    );
    assert.equal(mapToProductType("#themedcupcakes #cakemaker"), "cupcakes");
    assert.deepEqual(mapToProductTypes("#themedcupcakes #cakemaker"), ["cupcakes"]);
    assert.deepEqual(mapToProductTypes("#cupcakes #cakemaker"), ["cupcakes"]);
    assert.deepEqual(mapToProductTypes("#weddingcake #cakes"), ["wedding-cake"]);
  });

  it("maps recognised occasion hashtags to celebratory cakes", () => {
    for (const tag of [
      "#birthdaycake",
      "#birthday-cake",
      "#nikahcake",
      "#nikkahcake",
      "#nikah-cake",
      "#nikkah-cake",
      "#engagementcake",
      "#engagement",
      "#anniversarycake",
      "#anniversary-cake",
      "#christeningcake",
      "#birthday_cake",
      "#UmrahMubarak",
      "#umrah-cake",
      "#umrahcake",
      "#birthday-cakes",
      "#anniversarycakes",
      "#birthday",
      "#anniversary",
    ]) {
      assert.equal(mapToProductType(tag), "celebratory-cakes", tag);
      assert.equal(productTypeForHashtag(tag), "celebratory-cakes", tag);
      assert.equal(productTypeForHashtag(tag.slice(1)), "celebratory-cakes", tag);
    }

    assert.equal(mapToProductType("#BirthdayCake"), "celebratory-cakes");
    assert.equal(mapToProductType("#Birthday-Cake"), "celebratory-cakes");
    assert.equal(mapToProductType("#ANNIVERSARYCAKE"), "celebratory-cakes");
    assert.equal(mapToProductType("#Anniversary-Cake"), "celebratory-cakes");
    assert.equal(mapToProductType("engagement party #engagement"), "celebratory-cakes");
    assert.equal(
      mapToProductType("#UmrahMubarak #CustomCakes #MadeWithLove #cakes"),
      "celebratory-cakes"
    );
    assert.deepEqual(
      recognisedProductTypes(
        "🕋🤍 Umrah cake! A sweet celebration for a blessed journey. ✨🎂\n\n#UmrahMubarak #CustomCakes #MadeWithLove #cakes"
      ),
      ["celebratory-cakes"]
    );
    assert.equal(productTypeForHashtag("#CustomCakes"), null);
    assert.equal(productTypeForHashtag("#cakes"), null);
  });

  it("recognises occasion and cake compounds, and rejects occasion words on their own", () => {
    for (const tag of [
      "#umrah-cake",
      "#umrahcake",
      "#umrah_cake",
      "#birthday-cakes",
      "#birthday_cakes",
      "#anniversarycake",
      "#anniversary-cakes",
      "#UmrahMubarak",
      "#umrah-mubarak",
    ]) {
      assert.equal(productTypeForHashtag(tag), "celebratory-cakes", tag);
      assert.equal(productTypeForHashtag(tag.slice(1)), "celebratory-cakes", tag);
      assert.deepEqual(mapToProductTypes(tag), ["celebratory-cakes"], tag);
      assert.equal(mapToProductType(tag), "celebratory-cakes", tag);
    }

    assert.equal(productTypeForHashtag("#birthdayparty"), null);
    assert.equal(productTypeForHashtag("#birthday_party"), null);
    assert.equal(productTypeForHashtag("#Birthday-Party"), null);
    assert.equal(mapToProductType("#birthdayparty"), null);
    assert.deepEqual(mapToProductTypes("#birthdayparty"), []);
    assert.deepEqual(classificationForGalleryItem("#birthdayparty"), {});
    assert.deepEqual(mapToProductTypes("#birthdayparty #custom-cakes"), ["other-fun-bakes"]);
    assert.deepEqual(recognisedProductTypes("#birthdayparty #wedding-cake"), ["wedding-cake"]);

    assert.equal(productTypeForHashtag("#weddingexhibition"), null);
    assert.equal(productTypeForHashtag("#weddingshow"), null);
    assert.deepEqual(mapToProductTypes("#weddingexhibition"), []);
    assert.deepEqual(mapToProductTypes("#weddingshow"), []);
    assert.deepEqual(mapToProductTypes("#weddingexhibition #weddingshow"), []);
    assert.equal(mapToProductType("#weddingexhibition"), null);

    assert.equal(productTypeForHashtag("#birthdaycupcakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#weddingcupcakes"), "cupcakes");
    assert.deepEqual(mapToProductTypes("#birthdaycupcakes"), ["cupcakes"]);
    assert.deepEqual(mapToProductTypes("#weddingcupcakes"), ["cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#birthdaycupcakes #anniversarycake"), [
      "cupcakes",
      "celebratory-cakes",
    ]);

    assert.equal(productTypeForHashtag("#wedding-cake"), "wedding-cake");
    assert.equal(productTypeForHashtag("#wedding_cakes"), "wedding-cake");
    assert.deepEqual(mapToProductTypes("#wedding-cake"), ["wedding-cake"]);
    assert.equal(productTypeForHashtag("#cup-cakes"), "cupcakes");
    assert.equal(productTypeForHashtag("#cup_cakes"), "cupcakes");

    assert.equal(productTypeForHashtag("#custom-cakes"), null);
    assert.deepEqual(mapToProductTypes("#custom-cakes"), ["other-fun-bakes"]);
    assert.equal(mapToProductType("#custom-cakes"), "other-fun-bakes");
    assert.deepEqual(mapToProductTypes("#custom-cakes #umrah-cake"), ["celebratory-cakes"]);

    assert.deepEqual(recognisedProductTypes("#wedding-cake #umrah-cake"), [
      "wedding-cake",
      "celebratory-cakes",
    ]);
    assert.equal(mapToProductType("#wedding-cake #anniversarycake"), "wedding-cake");
    assert.deepEqual(mapToProductTypes("#wedding-cake #anniversarycake"), [
      "wedding-cake",
      "celebratory-cakes",
    ]);
    assert.deepEqual(classificationForGalleryItem("#macarons"), {});
    assert.equal(mapToProductType("#birthdayparty #weddingshow"), null);
  });

  it("keeps a wedding cake with a generic celebration tag out of celebratory cakes", () => {
    assert.equal(productTypeForHashtag("#celebrationcake"), null);
    assert.equal(productTypeForHashtag("#celebration-cake"), null);
    assert.equal(productTypeForHashtag("#celebration_cakes"), null);
    assert.equal(productTypeForHashtag("#CelebrationCake"), null);
    assert.equal(productTypeForHashtag("#celebration"), null);
    assert.deepEqual(mapToProductTypes("#celebrationcake"), ["other-fun-bakes"]);
    assert.deepEqual(
      recognisedProductTypes("#WeddingCake #wedding #whiterose #celebrationcake"),
      ["wedding-cake"]
    );
    assert.equal(
      mapToProductType("#WeddingCake #wedding #whiterose #celebrationcake"),
      "wedding-cake"
    );
    assert.deepEqual(
      mapToProductTypes("#WeddingCake #wedding #whiterose #celebrationcake"),
      ["wedding-cake"]
    );
    assert.deepEqual(recognisedProductTypes("#WeddingCake #birthdaycake #celebrationcake"), [
      "wedding-cake",
      "celebratory-cakes",
    ]);
    assert.deepEqual(recognisedProductTypes("#celebrationcupcakes"), ["cupcakes"]);
    assert.equal(productTypeForHashtag("#sweetcelebrationsweddingcakes"), "wedding-cake");
    assert.deepEqual(recognisedProductTypes("#sweetcelebrationsweddingcakes #cupcakes"), [
      "wedding-cake",
      "cupcakes",
    ]);
  });

  it("uses other fun bakes only when no specific category matches", () => {
    for (const tag of [
      "#cakes",
      "#cakemaker",
      "#customcakes",
      "#bluecake",
      "#LemonCake",
      "#CakeDesigner",
      "#CakeDesign",
      "#ThreeTierCake",
      "#ChocolateCake",
      "#FloralCake",
      "#VintageCake",
      "#cake",
    ]) {
      assert.equal(productTypeForHashtag(tag), null, tag);
      assert.deepEqual(mapToProductTypes(tag), ["other-fun-bakes"], tag);
      assert.equal(mapToProductType(tag), "other-fun-bakes", tag);
    }

    assert.deepEqual(mapToProductTypes("#cakes #cakemaker"), ["other-fun-bakes"]);
    assert.deepEqual(mapToProductTypes("#birthdaycake #customcakes"), ["celebratory-cakes"]);
    assert.deepEqual(mapToProductTypes("#Custom-Cake"), ["other-fun-bakes"]);
    assert.deepEqual(recognisedProductTypes("#weddingcake #birthdaycake"), [
      "wedding-cake",
      "celebratory-cakes",
    ]);
  });

  it("collects every matching product type instead of stopping at the first", () => {
    assert.deepEqual(recognisedProductTypes("#weddingcakeideas #cupcakes"), ["wedding-cake", "cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#CUPCAKES #Luxury-Wedding-Cake"), ["wedding-cake", "cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#weddingcake #birthdaycake"), ["wedding-cake", "celebratory-cakes"]);
    assert.deepEqual(recognisedProductTypes("#birthdaycake #wedding-cake"), ["wedding-cake", "celebratory-cakes"]);
    assert.deepEqual(recognisedProductTypes("#customcake #cupcakes"), ["cupcakes"]);
    assert.deepEqual(recognisedProductTypes("#anniversarycake #cupcakes"), ["cupcakes", "celebratory-cakes"]);
    assert.deepEqual(recognisedProductTypes("#cupcakes #nikahcake"), ["cupcakes", "celebratory-cakes"]);
    assert.deepEqual(
      recognisedProductTypes("#weddingcake #cupcakes #birthdaycake"),
      ["wedding-cake", "cupcakes", "celebratory-cakes"]
    );
    assert.deepEqual(
      recognisedProductTypes("#cupcakes #Cupcakes #cupcake #cupcakes"),
      ["cupcakes"]
    );
    assert.deepEqual(recognisedProductTypes("#Birthday-Cake #engagement"), ["celebratory-cakes"]);
    assert.deepEqual(recognisedProductTypes("#nikah-cake #anniversary-cake"), ["celebratory-cakes"]);
    assert.deepEqual(mapToProductTypes("#weddingcake #birthdaycake"), ["wedding-cake", "celebratory-cakes"]);
    assert.equal(mapToProductType("#weddingcake #birthdaycake"), "wedding-cake");
    assert.equal(mapToProductType("#customcake #cupcakes"), "cupcakes");
    assert.equal(mapToProductType("#cupcakes #weddingcake"), "wedding-cake");
    assert.deepEqual(mapToProductTypes(undefined), []);
    assert.deepEqual(recognisedProductTypes("#engagement #cupcakes #weddingcakes"), [
      "wedding-cake",
      "cupcakes",
      "celebratory-cakes",
    ]);
  });

  it("does not classify prose, and leaves a hashtag-free caption unclassifiable", () => {
    assert.equal(recognisedProductType("birthday cake and anniversary cake"), null);
    assert.equal(recognisedProductType("our engagements"), null);
    assert.equal(recognisedProductType("a custom cake for the weekend"), null);
    assert.equal(recognisedProductType("an elegant wedding cake for Saturday"), null);
    assert.equal(recognisedProductType("#weddingday #weddingshow"), null);
    assert.equal(recognisedProductType("#weddingexhibition"), null);
    assert.equal(recognisedProductType("#macarons"), null);
    assert.equal(recognisedProductType("#flowers #dessert"), null);
    assert.equal(recognisedProductType("cake"), null);
    assert.equal(mapToProductType("birthday cake and anniversary cake"), null);
    assert.equal(mapToProductType("an elegant wedding cake for Saturday"), null);
    assert.equal(mapToProductType("our engagements"), null);
    assert.equal(mapToProductType("#macarons"), null);
    assert.equal(mapToProductType(""), null);
    assert.equal(mapToProductType(undefined), null);
    assert.deepEqual(mapToProductTypes("#weddingday #weddingshow"), []);
    assert.equal(mapToProductType("#birthday"), "celebratory-cakes");
    assert.equal(mapToProductType("#anniversary"), "celebratory-cakes");
    assert.deepEqual(classificationForGalleryItem("#macarons"), {});
    assert.deepEqual(
      classificationForGalleryItem("#macarons", { productType: "wedding-cake" }),
      { productType: "wedding-cake" }
    );
    assert.deepEqual(classificationForGalleryItem("#cakes"), {
      productType: "other-fun-bakes",
      productTypes: ["other-fun-bakes"],
    });
  });

  it("stores birthday and anniversary carousels as one gallery item", async () => {
    async function syncCarousel(id: string, caption: string) {
      const env = harness({
        routes: (call) => {
          if (call.pathname.endsWith(`/${id}/children`)) {
            return jsonResponse(200, {
              data: [
                { id: `${id}-a`, media_type: "IMAGE", media_url: `https://cdn.example/${id}-a.jpg` },
                { id: `${id}-b`, media_type: "IMAGE", media_url: `https://cdn.example/${id}-b.jpg` },
              ],
            });
          }
          return jsonResponse(200, {
            data: [
              media(id, "2026-10-03T00:00:00+0000", {
                media_type: "CAROUSEL_ALBUM",
                caption,
              }),
            ],
          });
        },
      });
      const summary = await runInstagramSync(env.deps);
      return { env, summary };
    }

    const birthday = await syncCarousel("birthday-album", "#birthdaycake");
    assert.equal(birthday.summary.saved, 1);
    const birthdayItem = birthday.env.store.get("birthday-album");
    assert.equal(birthdayItem?.productType, "celebratory-cakes");
    assert.deepEqual(birthdayItem?.productTypes, ["celebratory-cakes"]);
    assert.equal(birthdayItem?.mediaType, "CAROUSEL_ALBUM");
    assert.deepEqual(
      birthdayItem?.media?.map((asset) => asset.mediaId),
      ["birthday-album-a", "birthday-album-b"]
    );
    assert.equal(birthday.env.uploads().length, 2);

    const anniversary = await syncCarousel("anniversary-album", "#AnniversaryCake");
    assert.equal(anniversary.summary.saved, 1);
    const anniversaryItem = anniversary.env.store.get("anniversary-album");
    assert.equal(anniversaryItem?.productType, "celebratory-cakes");
    assert.deepEqual(anniversaryItem?.productTypes, ["celebratory-cakes"]);
    assert.equal(anniversaryItem?.mediaType, "CAROUSEL_ALBUM");
    assert.deepEqual(
      anniversaryItem?.media?.map((asset) => asset.mediaId),
      ["anniversary-album-a", "anniversary-album-b"]
    );
    assert.equal(anniversary.env.uploads().length, 2);
  });
});

describe("authentication failures", () => {
  it("turns OAuthException 190 into a re-authorisation error and does not refresh", async () => {
    const env = harness({
      routes: () => jsonResponse(400, revokedBody),
    });

    await assert.rejects(runInstagramSync(env.deps), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /code 190/);
      assert.match(error.message, /opulence-wedding-bakes\/instagram-access-token/);
      assert.match(error.message, /Manual re-authorisation/);
      assert.equal(error.message.includes("LEAKED-TOKEN-VALUE"), false);
      return true;
    });

    assert.deepEqual(env.refreshCalls, []);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
    assert.equal(env.saveAttempts(), 0);
  });

  it("fails a non-authentication HTTP error without a success metric", async () => {
    const env = harness({
      routes: () =>
        jsonResponse(500, {
          error: { message: "Temporary failure", type: "GraphMethodException", code: 2 },
        }),
    });

    await assert.rejects(runInstagramSync(env.deps), /HTTP 500/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
    assert.deepEqual(env.refreshCalls, []);
  });
});

describe("token lifecycle", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const eligibleSecret = JSON.stringify({
    accessToken: RAW_TOKEN,
    expiresAt: "2026-10-20T12:00:00.000Z",
    refreshedAt: "2026-09-01T12:00:00.000Z",
  });

  it("does not treat a raw secret as refreshable", () => {
    const token = parseStoredToken(RAW_TOKEN);
    assert.equal(token.format, "raw");
    assert.equal(token.expiresAt, null);
    assert.equal(isRefreshEligible(token, now), false);
  });

  it("refreshes a valid token inside the documented window and stores Meta expiry", async () => {
    const env = harness({
      secret: eligibleSecret,
      now,
      routes: (call) => {
        if (call.pathname === "/refresh_access_token") {
          return jsonResponse(200, { access_token: REFRESHED_TOKEN, token_type: "bearer", expires_in: 5184000 });
        }
        if (call.pathname === "/v18.0/me") {
          return jsonResponse(200, { id: ACCOUNT_ID });
        }
        return jsonResponse(200, { data: [media("new-post", "2026-10-01T10:00:00+0000")] });
      },
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 1);
    assert.equal(env.refreshCalls.length, 1);
    assert.equal(env.mediaUsedRefreshedToken(), true);
    assert.equal(env.metricWrites(), 1);

    const stored = JSON.parse(env.secret()) as { accessToken: string; expiresAt: string; refreshedAt: string };
    assert.equal(stored.accessToken, REFRESHED_TOKEN);
    assert.equal(stored.refreshedAt, now.toISOString());
    assert.equal(stored.expiresAt, new Date(now.getTime() + 5184000 * 1000).toISOString());
  });

  it("does not refresh a token younger than 24 hours or already expired", () => {
    const young = parseStoredToken(JSON.stringify({
      accessToken: RAW_TOKEN,
      expiresAt: "2026-10-18T12:00:00.000Z",
      refreshedAt: "2026-10-17T06:00:00.000Z",
    }));
    const expired = parseStoredToken(JSON.stringify({
      accessToken: RAW_TOKEN,
      expiresAt: "2026-10-01T00:00:00.000Z",
      refreshedAt: "2026-08-01T00:00:00.000Z",
    }));
    assert.equal(isRefreshEligible(young, now), false);
    assert.equal(isRefreshEligible(expired, now), false);
  });

  it("does not store an invalid refresh response", async () => {
    const env = harness({
      secret: eligibleSecret,
      now,
      routes: (call) => {
        if (call.pathname === "/refresh_access_token") {
          return jsonResponse(200, { access_token: "", expires_in: 5184000 });
        }
        return jsonResponse(500, { error: { message: "should not list media", code: 1 } });
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /did not include an access token/);
    assert.equal(env.saveAttempts(), 0);
    assert.equal(env.secret(), eligibleSecret);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
  });

  it("leaves the previous secret in place when Secrets Manager rejects the write", async () => {
    const env = harness({
      secret: eligibleSecret,
      now,
      failSecretWrite: true,
      routes: (call) => {
        if (call.pathname === "/refresh_access_token") {
          return jsonResponse(200, { access_token: REFRESHED_TOKEN, expires_in: 5184000 });
        }
        if (call.pathname === "/v18.0/me") return jsonResponse(200, { id: ACCOUNT_ID });
        return jsonResponse(500, { error: { message: "should not list media", code: 1 } });
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /previous secret was left unchanged/);
    assert.equal(env.saveAttempts(), 1);
    assert.equal(env.secret(), eligibleSecret);
    assert.equal(env.metricWrites(), 0);
  });

  it("does not store a replacement token that fails validation with code 190", async () => {
    const env = harness({
      secret: eligibleSecret,
      now,
      me: jsonResponse(400, revokedBody),
      routes: (call) => {
        if (call.pathname === "/refresh_access_token") {
          return jsonResponse(200, { access_token: REFRESHED_TOKEN, expires_in: 5184000 });
        }
        if (call.pathname === "/v18.0/me") return jsonResponse(400, revokedBody);
        return jsonResponse(500, { error: { message: "should not list media", code: 1 } });
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /code 190/);
    assert.equal(env.saveAttempts(), 0);
    assert.equal(env.secret(), eligibleSecret);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
  });

  it("accepts a token whose account matches the configured account before reading media", async () => {
    const env = harness({
      routes: (call) => {
        if (call.pathname === `/v18.0/${ACCOUNT_ID}/media`) {
          return jsonResponse(200, { data: [media("checked-post", "2026-10-01T10:00:00+0000")] });
        }
        return jsonResponse(500, { error: { message: "unexpected graph call", code: 1 } });
      },
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 1);
    assert.equal(env.calls[0]?.pathname, "/v18.0/me");
    assert.equal(env.calls.some((call) => call.pathname === `/v18.0/${ACCOUNT_ID}/media`), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.store.get("checked-post")?.photoId, "checked-post");
  });

  it("does not store a replacement token for a different Instagram account", async () => {
    const otherAccount = "99900000000000000";
    const env = harness({
      secret: eligibleSecret,
      now,
      me: jsonResponse(200, { id: otherAccount }),
      routes: (call) => {
        if (call.pathname === "/refresh_access_token") {
          return jsonResponse(200, { access_token: REFRESHED_TOKEN, expires_in: 5184000 });
        }
        return jsonResponse(500, { error: { message: "should not list media", code: 1 } });
      },
    });

    await assert.rejects(runInstagramSync(env.deps), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(otherAccount));
      assert.match(error.message, new RegExp(ACCOUNT_ID));
      assert.equal(error.message.includes(RAW_TOKEN), false);
      assert.equal(error.message.includes(REFRESHED_TOKEN), false);
      return true;
    });
    assert.deepEqual(
      env.calls.map((call) => call.pathname),
      ["/refresh_access_token", "/v18.0/me"]
    );
    assert.equal(env.saveAttempts(), 0);
    assert.equal(env.secret(), eligibleSecret);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
  });

  it("rejects a different account before media, retries, gallery writes, or success", async () => {
    const otherAccount = "99900000000000000";
    const env = harness({
      me: jsonResponse(200, { id: otherAccount }),
      routes: () => jsonResponse(500, { error: { message: "should not list media", code: 1 } }),
    });
    env.recovery.initialised = true;
    env.recovery.failures.set("pending-post", BOUNDARY);

    await assert.rejects(runInstagramSync(env.deps), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(otherAccount));
      assert.match(error.message, new RegExp(ACCOUNT_ID));
      assert.equal(error.message.includes(RAW_TOKEN), false);
      return true;
    });
    assert.deepEqual(env.calls.map((call) => call.pathname), ["/v18.0/me"]);
    assert.equal(env.recovery.failures.has("pending-post"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
  });
});

describe("pagination and imports", () => {
  it("follows the cursor and imports every post that ties the boundary", async () => {
    const env = harness({
      routes: (call) => {
        if (!call.after) {
          return jsonResponse(200, {
            data: [
              media("tie-a", BOUNDARY),
              media("tie-b", "2026-09-28T16:53:07Z"),
              media("newer", "2026-10-02T09:00:00+0000", { caption: "#cupcakes" }),
            ],
            paging: { cursors: { after: "page-2" }, next: "https://graph.instagram.com/next-page" },
          });
        }
        return jsonResponse(200, {
          data: [media("older", "2026-09-01T00:00:00+0000")],
        });
      },
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 3);
    assert.equal(env.store.has("tie-a"), true);
    assert.equal(env.store.has("tie-b"), true);
    assert.equal(env.store.has("newer"), true);
    assert.equal(env.store.has("older"), false);
    assert.equal(env.store.get("newer")?.productType, "cupcakes");
    assert.equal(env.calls.filter((call) => call.pathname.endsWith("/media")).length, 2);
    assert.equal(env.calls.some((call) => call.after === "page-2"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
  });

  it("fails an initial import that still has pages after the cap", async () => {
    const env = harness({
      boundary: null,
      maxPages: 1,
      routes: () =>
        jsonResponse(200, {
          data: [media("first", "2026-10-05T00:00:00+0000")],
          paging: { cursors: { after: "more" }, next: "https://graph.instagram.com/next-page" },
        }),
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.has("first"), true);
  });

  it("fails when the page cap is reached before the boundary", async () => {
    const env = harness({
      maxPages: 1,
      routes: () =>
        jsonResponse(200, {
          data: [media("only-page", "2026-10-05T00:00:00+0000")],
          paging: { cursors: { after: "more" }, next: "https://graph.instagram.com/next-page" },
        }),
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    assert.equal(env.store.has("only-page"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
  });

  it("upserts the same photoId instead of creating a duplicate", async () => {
    const route = () =>
      jsonResponse(200, { data: [media("same-id", "2026-10-03T00:00:00+0000")] });
    const env = harness({ routes: route });

    await runInstagramSync(env.deps);
    await runInstagramSync(env.deps);

    const matches = [...env.store.keys()].filter((id) => id === "same-id");
    assert.equal(matches.length, 1);
    assert.equal(env.store.size, 2);
  });

  it("fails the invocation when one post fails and keeps earlier writes", async () => {
    const env = harness({
      routes: () =>
        jsonResponse(200, {
          data: [
            media("good-post", "2026-10-04T00:00:00+0000"),
            media("bad-post", "2026-10-04T01:00:00+0000", { media_url: "https://cdn.example/missing.jpg" }),
          ],
        }),
    });
    env.deps.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname !== "graph.instagram.com") {
        if (parsed.pathname.endsWith("/missing.jpg")) return jsonResponse(404, { error: "missing" });
        return imageResponse();
      }
      if (parsed.pathname === "/v18.0/me") return jsonResponse(200, { id: ACCOUNT_ID });
      return jsonResponse(200, {
        data: [
          media("good-post", "2026-10-04T00:00:00+0000"),
          media("bad-post", "2026-10-04T01:00:00+0000", { media_url: "https://cdn.example/missing.jpg" }),
        ],
      });
    };

    await assert.rejects(runInstagramSync(env.deps), /bad-post/);
    assert.equal(env.store.has("good-post"), true);
    assert.equal(env.store.has("bad-post"), false);
    assert.equal(env.metricWrites(), 0);
  });

  it("skips videos and still completes", async () => {
    const env = harness({
      routes: () =>
        jsonResponse(200, {
          data: [
            media("clip", "2026-10-06T00:00:00+0000", { media_type: "VIDEO", media_url: undefined }),
            media("photo", "2026-10-06T01:00:00+0000", { caption: "#engagementcake" }),
          ],
        }),
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.saved, 1);
    assert.equal(env.store.has("clip"), false);
    assert.equal(env.store.get("photo")?.productType, "celebratory-cakes");
    assert.equal(env.metricWrites(), 1);
  });

  it("does not emit the success metric when the media list fails", async () => {
    const error = parseGraphError(400, JSON.stringify(revokedBody));
    assert.equal(error.reauthorisationRequired, true);
    assert.equal(error.httpStatus, 400);
    assert.equal(error.graphCode, 190);

    const env = harness({
      routes: () => jsonResponse(400, revokedBody),
    });
    await assert.rejects(runInstagramSync(env.deps));
    assert.equal(env.metricWrites(), 0);
  });
});

describe("recovery records", () => {
  it("reads a watermark and a failed post back from the stored shape", () => {
    const parsed = parseRecoveryItems([
      watermarkRecord("2026-09-28T16:53:07+0000"),
      failureRecord("older-post", "2026-10-09T12:00:00+0000", "2026-10-17T12:00:00.000Z"),
    ]);
    assert.equal(parsed.initialised, true);
    assert.equal(parsed.phase, "live");
    assert.equal(parsed.liveWatermark, "2026-09-28T16:53:07+0000");
    assert.equal(parsed.failures.length, 1);
    assert.equal(parsed.failures[0]?.mediaId, "older-post");
    assert.equal(parsed.failures[0]?.instagramTimestamp, "2026-10-09T12:00:00+0000");
  });

  it("does not treat a live row without a boundary as finished history", () => {
    const parsed = parseRecoveryItems([
      recoveryRecord({
        ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
        phase: "live",
        historyCovered: false,
        liveWatermark: null,
      }),
    ]);
    assert.equal(parsed.phase, "backfill");
    assert.equal(parsed.historyCovered, false);
  });

  it("fails a read that would drop an unidentifiable failure", () => {
    assert.throws(
      () => parseRecoveryItems([{ pk: "sync", sk: "failure#", mediaId: "  " }]),
      /missing a media id/
    );
  });
});

describe("failed post recovery", () => {
  const NEWER = "2026-10-10T12:00:00+0000";
  const OLDER = "2026-10-09T12:00:00+0000";

  function recoveryHarness(options?: {
    failRecoveryRead?: boolean;
    failWatermarkInit?: boolean;
    failRecordFailure?: boolean;
    failClearFailure?: boolean;
    failAdvanceWatermark?: boolean;
  }) {
    let phase: "first" | "second" = "first";
    let retryStatus = 200;
    const env = harness({
      ...options,
      routes: (call) => {
        if (call.pathname.endsWith("/media")) {
          if (phase === "second") {
            return jsonResponse(200, { data: [media("newer-post", NEWER)] });
          }
          return jsonResponse(200, {
            data: [
              media("newer-post", NEWER),
              media("older-post", OLDER, { media_url: undefined }),
            ],
          });
        }
        if (call.pathname.endsWith("/older-post")) {
          if (retryStatus !== 200) {
            return jsonResponse(retryStatus, {
              error: { message: "media temporarily unavailable", type: "GraphMethodException", code: 2 },
            });
          }
          return jsonResponse(200, media("older-post", OLDER));
        }
        return jsonResponse(404, { error: { message: "unexpected graph call", code: 1 } });
      },
    });

    return {
      env,
      failOlderOnRetry: () => {
        retryStatus = 500;
      },
      nextRun: () => {
        phase = "second";
      },
    };
  }

  it("keeps an older failed post for a later run after a newer post is saved", async () => {
    const { env, nextRun } = recoveryHarness();

    await assert.rejects(runInstagramSync(env.deps), /older-post/);
    assert.equal(env.store.has("newer-post"), true);
    assert.equal(env.store.has("older-post"), false);
    assert.equal(env.recovery.failures.has("older-post"), true);
    assert.equal(env.recovery.failures.get("older-post"), OLDER);
    assert.equal(env.recovery.position.liveWatermark === NEWER || env.recovery.position.phase === "backfill", true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.get("existing-post")?.caption, "kept");

    nextRun();
    const summary = await runInstagramSync(env.deps);

    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("older-post"), true);
    assert.equal(env.store.get("older-post")?.photoId, "older-post");
    assert.equal(env.recovery.failures.has("older-post"), false);
    assert.equal(env.recovery.failures.size, 0);
    assert.equal(env.metricWrites(), 1);
    assert.equal(
      env.calls.some((call) => call.pathname.endsWith("/older-post")),
      true
    );
    assert.equal(
      env.calls.filter((call) => call.pathname.endsWith("/media") && call.after === null).length >= 2,
      true
    );
  });

  it("does not emit SyncSuccess when the later retry fails, and keeps the post recorded", async () => {
    const { env, nextRun, failOlderOnRetry } = recoveryHarness();

    await assert.rejects(runInstagramSync(env.deps), /older-post/);
    nextRun();
    failOlderOnRetry();

    await assert.rejects(runInstagramSync(env.deps), /older-post/);
    assert.equal(env.store.has("older-post"), false);
    assert.equal(env.recovery.failures.has("older-post"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
  });

  it("clears only the post whose import succeeded", async () => {
    const env = harness({
      routes: (call) => {
        if (call.pathname.endsWith("/media")) return jsonResponse(200, { data: [] });
        if (call.pathname.endsWith("/recovered-post")) {
          return jsonResponse(200, media("recovered-post", "2026-10-08T00:00:00+0000"));
        }
        return jsonResponse(500, {
          error: { message: "still unavailable", type: "GraphMethodException", code: 2 },
        });
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      phase: "live",
      historyCovered: true,
      liveWatermark: BOUNDARY,
      pendingHead: BOUNDARY,
    };
    env.recovery.failures.set("recovered-post", "2026-10-08T00:00:00+0000");
    env.recovery.failures.set("stuck-post", "2026-10-07T00:00:00+0000");

    await assert.rejects(runInstagramSync(env.deps), /stuck-post/);
    assert.equal(env.store.has("recovered-post"), true);
    assert.equal(env.store.has("stuck-post"), false);
    assert.equal(env.recovery.failures.has("recovered-post"), false);
    assert.equal(env.recovery.failures.has("stuck-post"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.phase, "live");
  });

  it("fails the invocation when recovery state cannot be read", async () => {
    const { env } = recoveryHarness({ failRecoveryRead: true });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      phase: "live",
      historyCovered: true,
      liveWatermark: BOUNDARY,
      pendingHead: BOUNDARY,
    };
    env.recovery.failures.set("keep-me", OLDER);

    await assert.rejects(runInstagramSync(env.deps), /Failed to read Instagram sync recovery state/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.size, 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
    assert.equal(env.recovery.failures.has("keep-me"), true);
    assert.equal(env.recovery.position.liveWatermark, BOUNDARY);
    assert.equal(env.calls.some((call) => call.pathname.endsWith("/media")), false);
  });

  it("fails safely when a new failure cannot be persisted and still retries it later", async () => {
    const { env, nextRun } = recoveryHarness({ failRecordFailure: true });
    env.recovery.failures.set("keep-me", "2026-10-01T00:00:00+0000");

    await assert.rejects(runInstagramSync(env.deps), /Failed to record Instagram sync recovery state/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.position.resumeCursor, null);
    assert.equal(env.recovery.failures.has("keep-me"), true);
    assert.equal(env.recovery.failures.has("older-post"), false);
    assert.equal(env.store.has("newer-post"), true);
    assert.equal(env.store.get("existing-post")?.caption, "kept");

    nextRun();
    env.deps.recordFailure = async (mediaId, instagramTimestamp) => {
      env.recovery.failures.set(mediaId, instagramTimestamp);
    };
    env.deps.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname !== "graph.instagram.com") return imageResponse();
      if (parsed.pathname === "/v18.0/me") return jsonResponse(200, { id: ACCOUNT_ID });
      if (parsed.pathname.endsWith("/keep-me")) {
        return jsonResponse(200, media("keep-me", "2026-10-01T00:00:00+0000"));
      }
      if (parsed.pathname.endsWith("/media")) {
        return jsonResponse(200, {
          data: [media("newer-post", NEWER), media("older-post", OLDER)],
        });
      }
      return jsonResponse(404, { error: { message: "unexpected", code: 1 } });
    };

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("older-post"), true);
    assert.equal(env.recovery.failures.has("older-post"), false);
    assert.equal(env.recovery.failures.has("keep-me"), false);
    assert.equal(env.metricWrites(), 1);
  });

  it("fails safely when the watermark cannot be initialised or advanced", async () => {
    const init = harness({
      failWatermarkInit: true,
      routes: () => jsonResponse(200, { data: [media("should-not-save", NEWER)] }),
    });
    await assert.rejects(runInstagramSync(init.deps), /Failed to initialise Instagram sync recovery state/);
    assert.equal(init.metricWrites(), 0);
    assert.equal(init.store.has("should-not-save"), false);
    assert.equal(init.recovery.initialised, false);

    const advance = harness({
      failAdvanceWatermark: true,
      routes: () => jsonResponse(200, { data: [media("saved-post", NEWER)] }),
    });
    await assert.rejects(runInstagramSync(advance.deps), /Failed to advance Instagram sync recovery state/);
    assert.equal(advance.metricWrites(), 0);
    assert.equal(advance.store.has("saved-post"), true);
    assert.equal(advance.recovery.position.phase, "backfill");
    assert.equal(advance.store.get("existing-post")?.caption, "kept");
  });

  it("fails safely when a recovered post cannot be removed from the failure set", async () => {
    const env = harness({
      failClearFailure: true,
      routes: (call) => {
        if (call.pathname.endsWith("/older-post")) {
          return jsonResponse(200, media("older-post", OLDER));
        }
        return jsonResponse(200, { data: [] });
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      phase: "live",
      historyCovered: true,
      liveWatermark: BOUNDARY,
      pendingHead: BOUNDARY,
    };
    env.recovery.failures.set("older-post", OLDER);

    await assert.rejects(runInstagramSync(env.deps), /Failed to clear Instagram sync recovery state/);
    assert.equal(env.store.has("older-post"), true);
    assert.equal(env.recovery.failures.has("older-post"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.liveWatermark, BOUNDARY);
  });
});

function paged(posts: ReturnType<typeof media>[], cursor: string | null) {
  if (!cursor) return { data: posts };
  return {
    data: posts,
    paging: { cursors: { after: cursor }, next: `https://graph.instagram.com/page/${cursor}` },
  };
}

describe("historical continuation and backfill", () => {
  it("resumes after a page cap instead of skipping the next page", async () => {
    const env = harness({
      maxPages: 1,
      routes: (call) => {
        if (!call.after) {
          return jsonResponse(200, paged([media("page-a", "2026-10-12T00:00:00+0000")], "cursor-b"));
        }
        assert.equal(call.after, "cursor-b");
        return jsonResponse(200, paged([media("page-b", "2026-10-12T00:00:00+0000")], null));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.has("page-a"), true);
    assert.equal(env.store.has("page-b"), false);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.position.resumeCursor, "cursor-b");
    assert.equal(env.recovery.position.historyCovered, false);

    const callsBefore = env.calls.length;
    const summary = await runInstagramSync(env.deps);
    const resumed = env.calls.slice(callsBefore).find((call) => call.pathname.endsWith("/media"));
    assert.equal(resumed?.after, "cursor-b");
    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("page-b"), true);
    assert.equal(env.store.get("page-a")?.photoId, "page-a");
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
    assert.equal(env.recovery.position.resumeCursor, null);
  });

  it("finishes a historical walk across several capped invocations", async () => {
    const pages: Record<string, { id: string; timestamp: string; cursor: string | null }> = {
      head: { id: "p1", timestamp: "2026-10-15T00:00:00+0000", cursor: "c2" },
      c2: { id: "p2", timestamp: "2026-10-05T00:00:00+0000", cursor: "c3" },
      c3: { id: "p3", timestamp: "2026-09-29T00:00:00+0000", cursor: null },
    };
    const env = harness({
      maxPages: 1,
      routes: (call) => {
        const key = call.after ?? "head";
        const page = pages[key];
        assert.ok(page, `unexpected cursor ${call.after}`);
        return jsonResponse(200, paged([media(page.id, page.timestamp)], page.cursor));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.has("p3"), false);

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("p1"), true);
    assert.equal(env.store.has("p2"), true);
    assert.equal(env.store.has("p3"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
    assert.equal(env.recovery.position.historyCovered, true);
    assert.equal(env.calls.filter((call) => call.after === "c2").length >= 1, true);
    assert.equal(env.calls.filter((call) => call.after === "c3").length >= 1, true);
  });

  it("rewalks from the newest page when a saved cursor is rejected and does not finish early", async () => {
    let rejectSaved = false;
    let headCount = 0;
    const env = harness({
      maxPages: 1,
      routes: (call) => {
        if (call.after === "saved-cursor" && rejectSaved) {
          return jsonResponse(400, {
            error: { message: "Invalid cursor", type: "OAuthException", code: 100 },
          });
        }
        if (!call.after) {
          headCount += 1;
          const next = headCount === 1 ? "saved-cursor" : "fresh-cursor";
          return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], next));
        }
        return jsonResponse(200, paged([media("older-history", "2026-09-30T00:00:00+0000")], null));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    rejectSaved = true;
    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.has("older-history"), false);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.recovery.position.resumeCursor, "fresh-cursor");

    env.deps.maxPages = 3;
    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("older-history"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
  });

  it("does not treat an empty cursor page as the end of history", async () => {
    let emptyOnce = true;
    const env = harness({
      maxPages: 3,
      routes: (call) => {
        if (call.after === "saved-cursor" && emptyOnce) {
          emptyOnce = false;
          return jsonResponse(200, { data: [] });
        }
        if (!call.after) return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], "saved-cursor"));
        return jsonResponse(200, paged([media("older-history", "2026-09-30T00:00:00+0000")], null));
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      pendingHead: "2026-10-12T00:00:00+0000",
      resumeCursor: "saved-cursor",
      anchorId: "head-post",
      anchorTimestamp: "2026-10-12T00:00:00+0000",
    };
    env.store.set("head-post", {
      ...env.existing,
      photoId: "head-post",
      instagramTimestamp: "2026-10-12T00:00:00+0000",
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved >= 1, true);
    assert.equal(env.store.has("older-history"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
  });

  it("treats a cursor that returns newer posts as a restart and still imports the older post", async () => {
    let stale = false;
    let staleServed = false;
    const env = harness({
      maxPages: 1,
      routes: (call) => {
        if (call.after === "c2" && stale && !staleServed) {
          staleServed = true;
          return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], "ignored-stale-cursor"));
        }
        if (!call.after) {
          const next = staleServed ? "fresh" : "c2";
          return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], next));
        }
        assert.equal(call.after, "fresh");
        return jsonResponse(200, paged([media("older-history", "2026-09-30T00:00:00+0000")], null));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    stale = true;
    env.deps.maxPages = 3;
    const callsBefore = env.calls.length;
    await runInstagramSync(env.deps);
    const mediaCalls = env.calls.slice(callsBefore).filter((call) => call.pathname.endsWith("/media"));
    assert.deepEqual(mediaCalls.map((call) => call.after ?? "head"), ["c2", "head", "fresh"]);
    assert.equal(env.store.has("older-history"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.historyCovered, true);
  });

  it("does not finish history when a stale cursor page has no next link", async () => {
    let resumed = false;
    const env = harness({
      maxPages: 2,
      routes: (call) => {
        if (call.after === "saved-cursor") {
          resumed = true;
          return jsonResponse(200, { data: [media("head-post", "2026-10-12T00:00:00+0000")] });
        }
        if (!call.after) {
          assert.equal(resumed, true);
          return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], "fresh-cursor"));
        }
        assert.equal(call.after, "fresh-cursor");
        return jsonResponse(200, paged([media("older-history", "2026-09-30T00:00:00+0000")], "still-older"));
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      pendingHead: "2026-10-12T00:00:00+0000",
      resumeCursor: "saved-cursor",
      anchorId: "anchor-post",
      anchorTimestamp: "2026-10-01T00:00:00+0000",
    };
    env.store.set("anchor-post", {
      ...env.existing,
      photoId: "anchor-post",
      instagramTimestamp: "2026-10-01T00:00:00+0000",
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 2/);
    assert.equal(env.store.has("older-history"), true);
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.position.resumeCursor, "still-older");
    assert.equal(env.metricWrites(), 0);
  });

  it("completes a genuine one-page feed from a fresh head request", async () => {
    const env = harness({
      routes: () => jsonResponse(200, { data: [media("only-post", "2026-10-02T00:00:00+0000")] }),
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 1);
    assert.equal(env.store.has("only-post"), true);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
    assert.equal(env.recovery.position.historyCovered, true);
    assert.equal(env.recovery.position.resumeCursor, null);
  });

  it("keeps the saved cursor when the fresh head request fails after a stale page", async () => {
    const env = harness({
      routes: (call) => {
        if (call.after === "saved-cursor") {
          return jsonResponse(200, { data: [media("head-post", "2026-10-12T00:00:00+0000")] });
        }
        return jsonResponse(500, {
          error: { message: "Temporary failure", type: "GraphMethodException", code: 2 },
        });
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      pendingHead: "2026-10-12T00:00:00+0000",
      resumeCursor: "saved-cursor",
      anchorId: "anchor-post",
      anchorTimestamp: "2026-10-01T00:00:00+0000",
    };

    await assert.rejects(runInstagramSync(env.deps), /Temporary failure/);
    assert.equal(env.store.has("head-post"), false);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.resumeCursor, "saved-cursor");
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.recovery.position.phase, "backfill");
  });

  it("backfills a post older than the gallery maximum and upserts without duplicating", async () => {
    const env = harness({
      boundary: "2026-10-10T00:00:00+0000",
      routes: () =>
        jsonResponse(200, {
          data: [
            media("newest-saved", "2026-10-10T00:00:00+0000"),
            media("Dd6Q4zRNaby", "2026-09-29T08:00:00+0000", { caption: "#cupcakes" }),
          ],
        }),
    });

    const first = await runInstagramSync(env.deps);
    assert.equal(first.saved, 2);
    assert.equal(env.store.has("Dd6Q4zRNaby"), true);
    assert.equal(env.store.get("Dd6Q4zRNaby")?.productType, "cupcakes");
    assert.equal(env.store.get("existing-post")?.caption, "kept");
    assert.equal(env.metricWrites(), 1);
    const size = env.store.size;

    const second = await runInstagramSync(env.deps);
    assert.equal(second.saved >= 1, true);
    assert.equal(env.store.size, size);
    assert.equal([...env.store.keys()].filter((id) => id === "Dd6Q4zRNaby").length, 1);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
    assert.equal(env.calls.filter((call) => call.after === "deep-history").length, 0);
  });

  it("keeps a backfill failure retryable and emits success only after it imports", async () => {
    let failOlder = true;
    const env = harness({
      routes: (call) => {
        if (call.pathname.endsWith("/older-miss")) {
          return jsonResponse(200, media("older-miss", "2026-09-29T00:00:00+0000"));
        }
        return jsonResponse(200, {
          data: [
            media("newer-ok", "2026-10-11T00:00:00+0000"),
            media("older-miss", "2026-09-29T00:00:00+0000", {
              media_url: failOlder ? undefined : `https://cdn.example/older-miss.jpg`,
            }),
          ],
        });
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /older-miss/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.failures.has("older-miss"), true);
    assert.equal(env.store.has("newer-ok"), true);
    assert.equal(env.store.has("older-miss"), false);

    failOlder = false;
    await runInstagramSync(env.deps);
    assert.equal(env.store.has("older-miss"), true);
    assert.equal(env.recovery.failures.has("older-miss"), false);
    assert.equal(env.metricWrites(), 1);
    assert.equal(env.recovery.position.phase, "live");
  });

  it("does not skip a later page when continuation cannot be saved", async () => {
    const options = {
      failContinuationWrite: true,
      maxPages: 2,
      routes: (call: Call) => {
        if (!call.after) return jsonResponse(200, paged([media("first-page", "2026-10-08T00:00:00+0000")], "next-page"));
        return jsonResponse(200, paged([media("second-page", "2026-09-30T00:00:00+0000")], null));
      },
    };
    const env = harness(options);

    await assert.rejects(runInstagramSync(env.deps), /Failed to save Instagram sync continuation/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.store.has("first-page"), true);
    assert.equal(env.store.has("second-page"), false);
    assert.equal(env.recovery.position.resumeCursor, null);
    assert.equal(env.recovery.position.phase, "backfill");

    options.failContinuationWrite = false;
    await runInstagramSync(env.deps);
    assert.equal(env.store.has("second-page"), true);
    assert.equal(env.store.get("existing-post")?.caption, "kept");
    assert.equal(env.metricWrites(), 1);
  });

  it("does not re-import the whole backfill on the next incremental run", async () => {
    const seen: string[] = [];
    const env = harness({
      maxPages: 1,
      routes: (call) => {
        seen.push(call.after ?? "head");
        if (!call.after) return jsonResponse(200, paged([media("p1", "2026-10-15T00:00:00+0000")], "c2"));
        if (call.after === "c2") return jsonResponse(200, paged([media("p2", "2026-10-01T00:00:00+0000")], "c3"));
        return jsonResponse(200, paged([media("p3", "2026-09-29T00:00:00+0000")], null));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    await assert.rejects(runInstagramSync(env.deps), /page limit of 1/);
    await runInstagramSync(env.deps);
    assert.equal(env.recovery.position.phase, "live");
    const historical = seen.length;

    seen.length = 0;
    env.deps.maxPages = 10;
    await runInstagramSync(env.deps);
    assert.equal(seen.includes("c3"), false);
    assert.equal(seen.includes("head"), true);
    assert.equal(seen.length < historical, true);
    assert.equal(env.store.has("p3"), true);
    assert.equal(env.metricWrites(), 2);
  });

  it("rewalks when Graph code 100 rejects a cursor without using the error message", async () => {
    let rejected = false;
    const env = harness({
      maxPages: 3,
      routes: (call) => {
        if (call.pathname.endsWith("/kept-failure")) {
          return jsonResponse(500, {
            error: { message: "still unavailable", type: "GraphMethodException", code: 2, is_transient: true },
          });
        }
        if (call.after === "saved-cursor" && !rejected) {
          rejected = true;
          return jsonResponse(400, {
            error: {
              message: "Invalid parameter",
              type: "OAuthException",
              code: 100,
              error_subcode: 33,
              is_transient: false,
              error_data: { blame_field: "after" },
            },
          });
        }
        if (!call.after) {
          return jsonResponse(200, paged([media("head-post", "2026-10-12T00:00:00+0000")], "fresh-cursor"));
        }
        assert.equal(call.after, "fresh-cursor");
        return jsonResponse(200, paged([media("older-history", "2026-09-30T00:00:00+0000")], null));
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      pendingHead: "2026-10-12T00:00:00+0000",
      resumeCursor: "saved-cursor",
      anchorId: "anchor-post",
      anchorTimestamp: "2026-10-01T00:00:00+0000",
    };
    env.recovery.failures.set("kept-failure", "2026-10-08T00:00:00+0000");

    await assert.rejects(runInstagramSync(env.deps), /kept-failure/);
    assert.equal(env.store.has("older-history"), true);
    assert.equal(env.recovery.failures.has("kept-failure"), true);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.calls.some((call) => call.after === "fresh-cursor"), true);
  });

  it("keeps the saved cursor when a continuation is throttled or transient", async () => {
    const env = harness({
      routes: (call) => {
        if (call.pathname.endsWith("/kept-failure")) {
          return jsonResponse(500, {
            error: { message: "still unavailable", type: "GraphMethodException", code: 2 },
          });
        }
        if (call.after === "saved-cursor") {
          return jsonResponse(400, {
            error: {
              message: "Application request limit reached",
              type: "OAuthException",
              code: 4,
              is_transient: true,
            },
          });
        }
        return jsonResponse(200, paged([media("should-not-import", "2026-10-12T00:00:00+0000")], null));
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      resumeCursor: "saved-cursor",
      anchorId: "anchor-post",
      anchorTimestamp: "2026-10-01T00:00:00+0000",
    };
    env.recovery.failures.set("kept-failure", "2026-10-08T00:00:00+0000");

    await assert.rejects(runInstagramSync(env.deps), /request limit/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.resumeCursor, "saved-cursor");
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.failures.has("kept-failure"), true);
    assert.equal(env.store.has("should-not-import"), false);
    assert.equal(
      env.calls.some((call) => call.pathname.endsWith("/media") && call.after === null),
      false
    );
  });

  it("keeps the saved cursor when Graph code 100 is marked transient", async () => {
    const env = harness({
      routes: (call) => {
        if (call.after === "saved-cursor") {
          return jsonResponse(400, {
            error: {
              message: "Please retry",
              type: "OAuthException",
              code: 100,
              is_transient: true,
            },
          });
        }
        return jsonResponse(200, { data: [media("should-not-import", "2026-10-12T00:00:00+0000")] });
      },
    });
    env.recovery.initialised = true;
    env.recovery.position = {
      ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
      resumeCursor: "saved-cursor",
      anchorId: "anchor-post",
      anchorTimestamp: "2026-10-01T00:00:00+0000",
    };

    await assert.rejects(runInstagramSync(env.deps), /Please retry/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.resumeCursor, "saved-cursor");
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.store.has("should-not-import"), false);
  });

  it("stops a repeated continuation cursor without marking history complete", async () => {
    const env = harness({
      maxPages: 10,
      routes: (call) => {
        const posts = [media("head-post", "2026-10-12T00:00:00+0000")];
        if (!call.after) return jsonResponse(200, paged(posts, "again"));
        return jsonResponse(200, paged(posts, "again"));
      },
    });

    await assert.rejects(runInstagramSync(env.deps), /repeated a paging cursor/);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.position.historyCovered, false);
    assert.equal(env.recovery.position.phase, "backfill");
    assert.equal(env.recovery.position.resumeCursor, null);
    assert.equal(env.store.has("head-post"), true);
    assert.equal(env.calls.filter((call) => call.pathname.endsWith("/media")).length < 6, true);
  });

  it("refreshes stored gallery metadata without uploading the image again", async () => {
    let likes = 4;
    const env = harness({
      routes: () =>
        jsonResponse(200, {
          data: [
            media("existing-post", BOUNDARY, { caption: "#cupcakes", like_count: likes }),
            media("new-post", BOUNDARY, { like_count: 2 }),
          ],
        }),
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 2);
    assert.deepEqual(env.uploads(), ["new-post"]);
    const existing = env.store.get("existing-post");
    assert.equal(existing?.backupUrl, "https://example.com/existing.jpg");
    assert.equal(existing?.likes, 4);
    assert.equal(existing?.productType, "cupcakes");
    assert.equal(existing?.caption, "#cupcakes");
    assert.equal(existing?.instagramTimestamp, BOUNDARY);

    likes = 8;
    await runInstagramSync(env.deps);
    assert.deepEqual(env.uploads(), ["new-post"]);
    assert.equal(env.store.get("existing-post")?.likes, 8);
    assert.equal(env.store.get("new-post")?.backupUrl, "https://bucket.example/new-post.jpg");
    assert.equal(env.store.size, 2);
  });

  it("reuses stored carousel images and uploads only a new child", async () => {
    const env = harness({
      routes: (call) => {
        if (call.pathname.endsWith("/album/children")) {
          return jsonResponse(200, {
            data: [
              { id: "child-a", media_type: "IMAGE", media_url: "https://cdn.example/child-a.jpg" },
              { id: "child-b", media_type: "IMAGE", media_url: "https://cdn.example/child-b.jpg" },
            ],
          });
        }
        return jsonResponse(200, {
          data: [
            {
              id: "album",
              media_type: "CAROUSEL_ALBUM",
              permalink: "https://www.instagram.com/p/album/",
              timestamp: "2026-10-03T00:00:00+0000",
              caption: "#weddingcake",
              like_count: 2,
            },
          ],
        });
      },
    });
    env.store.set("album", {
      ...env.existing,
      photoId: "album",
      mediaType: "CAROUSEL_ALBUM",
      backupUrl: "https://bucket.example/child-a.jpg",
      instagramTimestamp: "2026-10-03T00:00:00+0000",
      media: [
        { mediaId: "child-a", s3Key: "instagram/2026/child-a.jpg", url: "https://bucket.example/child-a.jpg" },
      ],
    });

    const summary = await runInstagramSync(env.deps);
    assert.equal(summary.saved, 1);
    assert.deepEqual(env.uploads(), ["child-b"]);
    const album = env.store.get("album");
    assert.equal(album?.backupUrl, "https://bucket.example/child-a.jpg");
    assert.equal(album?.likes, 2);
    assert.equal(album?.instagramTimestamp, "2026-10-03T00:00:00+0000");
    assert.deepEqual(
      album?.media?.map((asset) => asset.mediaId),
      ["child-a", "child-b"]
    );
    assert.equal(album?.media?.[0]?.s3Key, "instagram/2026/child-a.jpg");
    assert.equal(album?.media?.[0]?.url, "https://bucket.example/child-a.jpg");
    assert.equal(album?.media?.[1]?.s3Key, "instagram/2024/child-b.jpg");
    assert.equal(album?.media?.[1]?.url, "https://bucket.example/child-b.jpg");
  });

  it("records a carousel whose child list is not valid JSON as a failed post", async () => {
    const env = harness({
      routes: (call) => {
        if (call.pathname.endsWith("/album/children")) {
          return {
            status: 200,
            text: async () => "not-json",
            arrayBuffer: async () => Buffer.from("not-json").buffer,
          };
        }
        return jsonResponse(200, {
          data: [
            {
              id: "album",
              media_type: "CAROUSEL_ALBUM",
              permalink: "https://www.instagram.com/p/album/",
              timestamp: "2026-10-03T00:00:00+0000",
              caption: "#weddingcake",
              like_count: 2,
            },
          ],
        });
      },
    });

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      await assert.rejects(
        runInstagramSync(env.deps),
        /Instagram sync incomplete\. 1 post\(s\) failed \(album\)/
      );
    } finally {
      console.error = originalError;
    }

    const logged = errors.map((entry) => entry.map(String).join(" ")).join("\n");
    assert.match(
      logged,
      /Failed to process media album: Instagram media album response was not valid JSON/
    );
    assert.equal(logged.includes("SyntaxError"), false);
    assert.equal(env.store.has("album"), false);
    assert.equal(env.uploads().length, 0);
    assert.equal(env.metricWrites(), 0);
    assert.equal(env.recovery.failures.has("album"), true);
  });
});
