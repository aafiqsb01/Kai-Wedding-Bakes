import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GalleryPage from "../../src/app/gallery/page";
import Home from "../../src/app/page";
import { FeaturedCommissions } from "../../src/components/sections/FeaturedCommissions";
import { docClient, GALLERY_TABLE } from "../../src/lib/dynamodb";
import { getGalleryCakes } from "../../src/lib/gallery";
import type { Cake } from "../../src/types";

const CLOUDFRONT = "https://d2zp5rpt2x30su.cloudfront.net";
const originalSend = docClient.send.bind(docClient);

afterEach(() => {
  docClient.send = originalSend;
});

function stubScan(items: Array<Record<string, unknown>>) {
  docClient.send = (async (command: ScanCommand) => {
    assert.equal(command.input.TableName, GALLERY_TABLE);
    return { Items: items };
  }) as typeof docClient.send;
}

function row(
  photoId: string,
  productType: string,
  options: {
    caption: string;
    likes: number;
    instagramTimestamp: string;
    productTypes?: string[];
  }
) {
  return {
    photoId,
    backupUrl: `https://opulence-wedding-bakes-photos.s3.eu-west-2.amazonaws.com/instagram/2026/${photoId}.jpg`,
    productType,
    productTypes: options.productTypes ?? [productType],
    caption: options.caption,
    likes: options.likes,
    instagramTimestamp: options.instagramTimestamp,
  };
}

function commissionRows() {
  return [
    row("wedding", "wedding-cake", {
      caption: "#weddingcake",
      likes: 40,
      instagramTimestamp: "2024-01-01T00:00:00.000Z",
    }),
    row("anniversary", "celebratory-cakes", {
      caption: "#anniversarycake",
      likes: 30,
      instagramTimestamp: "2024-04-01T00:00:00.000Z",
    }),
    row("cupcakes", "cupcakes", {
      caption: "#birthdaycake",
      likes: 20,
      instagramTimestamp: "2024-06-01T00:00:00.000Z",
      productTypes: ["cupcakes"],
    }),
    row("nikah", "celebratory-cakes", {
      caption: "#nikahcake",
      likes: 10,
      instagramTimestamp: "2024-03-01T00:00:00.000Z",
    }),
    row("birthday", "celebratory-cakes", {
      caption: "#birthdaycake",
      likes: 5,
      instagramTimestamp: "2024-02-01T00:00:00.000Z",
      productTypes: ["celebratory-cakes", "cupcakes"],
    }),
  ];
}

function imageUrl(photoId: string): string {
  return `${CLOUDFRONT}/instagram/2026/${photoId}.jpg`;
}

function findElement(node: ReactNode, type: unknown): React.ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: ReactNode }).children;
  const list = Array.isArray(children) ? children : children != null ? [children] : [];
  for (const child of list) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

function paragraphTexts(html: string): string[] {
  return [...html.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((match) => match[1] ?? "");
}

function gallerySections(html: string): Array<{ label: string; html: string }> {
  return html.split(/<h2[^>]*>/).slice(1).map((part) => {
    const end = part.indexOf("</h2>");
    return { label: part.slice(0, end), html: part };
  });
}

describe("homepage and gallery routes", () => {
  it("renders Recent Commissions from gallery rows, including recovered occasion labels", async () => {
    stubScan(commissionRows());

    const page = await Home();
    const featured = findElement(page, FeaturedCommissions);
    const cakes = (featured?.props as { cakes?: Cake[] } | undefined)?.cakes ?? [];

    assert.deepEqual(
      cakes.map((cake) => `${cake.id}:${cake.productType}`),
      [
        "wedding:wedding-cake",
        "anniversary:anniversary-cake",
        "cupcakes:cupcakes",
        "nikah:nikah-cake",
        "birthday:birthday-cake",
      ]
    );
    assert.equal(cakes.find((cake) => cake.id === "cupcakes")?.description, "#birthdaycake");

    const html = renderToStaticMarkup(page);
    assert.match(html, /Wedding Cakes Made to Celebrate You/);
    assert.match(html, /Custom Design/);
    assert.match(html, /Start Your Cake Design/);

    const recentStart = html.indexOf("Recent Commissions");
    const recentEnd = html.indexOf("Custom Design");
    const labels = paragraphTexts(html.slice(recentStart, recentEnd));
    const expected = [
      "Wedding Cake",
      "Anniversary Cake",
      "Cupcakes",
      "Nikkah Cake",
      "Birthday Cake",
    ];
    assert.deepEqual(labels.slice(0, expected.length), expected);
    assert.deepEqual(labels.slice(expected.length), expected);

    const stored = await getGalleryCakes();
    assert.equal(stored.find((cake) => cake.id === "cupcakes")?.productType, "cupcakes");
    assert.deepEqual(stored.find((cake) => cake.id === "cupcakes")?.productTypes, ["cupcakes"]);
    assert.equal(stored.find((cake) => cake.id === "birthday")?.productType, "celebratory-cakes");
    assert.deepEqual(stored.find((cake) => cake.id === "birthday")?.productTypes, [
      "celebratory-cakes",
      "cupcakes",
    ]);
  });

  it("keeps gallery sections on productTypes when a caption would change Recent Commissions", async () => {
    stubScan(commissionRows());

    const html = renderToStaticMarkup(await GalleryPage());
    const sections = gallerySections(html);

    assert.deepEqual(
      sections.map((section) => section.label),
      ["Celebratory Cakes", "Cupcakes", "Wedding Cake"]
    );
    assert.equal(sections.some((section) => section.label === "Birthday Cake"), false);
    assert.equal(sections.some((section) => section.label === "Anniversary Cake"), false);
    assert.equal(sections.some((section) => section.label === "Nikkah Cake"), false);

    const celebratory = sections.find((section) => section.label === "Celebratory Cakes");
    const cupcakes = sections.find((section) => section.label === "Cupcakes");
    const birthdayImage = imageUrl("birthday");
    assert.match(celebratory?.html ?? "", /Open Celebratory Cakes post/);
    assert.match(cupcakes?.html ?? "", /Open Cupcakes post/);
    assert.equal(celebratory?.html.includes(birthdayImage), true);
    assert.equal(cupcakes?.html.includes(birthdayImage), true);
    assert.equal(html.includes(imageUrl("anniversary")), true);
    assert.equal(
      sections.some(
        (section) => section.label !== "Celebratory Cakes" && section.html.includes(imageUrl("anniversary"))
      ),
      false
    );
  });
});
