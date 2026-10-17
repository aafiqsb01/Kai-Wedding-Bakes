import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoGalleryItem } from "../../config/database";
import { parseGraphError } from "./graph-error";
import { isRefreshEligible, parseStoredToken } from "./token-lifecycle";
import {
  mapToProductType,
  runInstagramSync,
  type GraphResponse,
  type SyncDependencies,
} from "./sync";

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
    getBoundary: async () => (options.boundary === undefined ? BOUNDARY : options.boundary),
    saveGalleryItem: async (item) => {
      store.set(item.photoId, item);
    },
    uploadPhoto: async (photoId) => `https://bucket.example/${photoId}.jpg`,
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
    saveAttempts: () => saveAttempts,
    secret: () => secret,
    mediaUsedRefreshedToken: () => mediaUsedRefreshedToken,
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
  it("keeps the existing hashtag rules", () => {
    assert.equal(mapToProductType("#weddingcake"), "wedding-cake");
    assert.equal(mapToProductType("#WeddingCake extra"), "wedding-cake");
    assert.equal(mapToProductType("#cupcakes #weddingcake"), "cupcakes");
    assert.equal(mapToProductType("engagement party #engagement"), "engagement-cake");
    assert.equal(mapToProductType("our engagements"), "wedding-cake");
    assert.equal(mapToProductType("#nikah-cake"), "nikah-cake");
    assert.equal(mapToProductType("#nikkah-cake"), "nikah-cake");
    assert.equal(mapToProductType(undefined), "wedding-cake");
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
    assert.equal(env.store.get("photo")?.productType, "engagement-cake");
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
