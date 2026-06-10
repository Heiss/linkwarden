import { prisma } from "@linkwarden/prisma";
import { createFile } from "@linkwarden/filesystem";

export const READER_LINK_NAME = "Reader view link-click fixture";
export const READER_ARTICLE_URL = "https://example.com/article";
export const READER_EXTERNAL_TARGET = "https://example.com/external-target";
export const READER_RELATIVE_HREF = "/relative/target";

const fillerParagraphs = Array.from(
  { length: 40 },
  (_, i) =>
    `<p>Filler paragraph number ${i} with enough words to give the reader view some vertical room to scroll.</p>`
).join("");

const articleContent =
  `<div>` +
  `<p>Opening paragraph with an ` +
  `<a id="e2e-external-link" href="${READER_EXTERNAL_TARGET}">external link</a>` +
  ` in the middle of the text.</p>` +
  `<p>Second paragraph with a ` +
  `<a id="e2e-relative-link" href="${READER_RELATIVE_HREF}">relative link</a>` +
  ` that should be resolved against the article URL.</p>` +
  fillerParagraphs +
  `<p id="e2e-footnote">Footnote target paragraph at the bottom.</p>` +
  `</div>`;

/**
 * Seeds an already-archived link with a readable (readability) snapshot
 * containing in-article anchors, so reader-view behaviour can be tested
 * without running the archival worker. Idempotent: reuses the fixture link
 * if it already exists.
 */
export async function seedReadableLink(username: string): Promise<number> {
  const user = await prisma.user.findFirst({ where: { username } });
  if (!user) {
    throw new Error(`seedReadableLink: user "${username}" does not exist`);
  }

  const existing = await prisma.link.findFirst({
    where: { name: READER_LINK_NAME, createdById: user.id },
  });
  if (existing) return existing.id;

  const collection = await prisma.collection.create({
    data: {
      name: "Reader view e2e",
      ownerId: user.id,
      createdById: user.id,
    },
  });

  // Mark every preservation format as resolved up-front so the background
  // worker never picks this link up and overwrites the seeded snapshot.
  const link = await prisma.link.create({
    data: {
      name: READER_LINK_NAME,
      url: READER_ARTICLE_URL,
      collectionId: collection.id,
      createdById: user.id,
      image: "unavailable",
      pdf: "unavailable",
      monolith: "unavailable",
      preview: "unavailable",
      readable: "pending",
      lastPreserved: new Date(),
    },
  });

  const readablePath = `archives/${collection.id}/${link.id}_readability.json`;

  const written = await createFile({
    filePath: readablePath,
    data: JSON.stringify({
      title: READER_LINK_NAME,
      content: articleContent,
      textContent: "Reader view link-click fixture article",
      excerpt: "Fixture article for reader-view e2e tests",
      byline: null,
      length: articleContent.length,
    }),
  });
  if (!written) {
    throw new Error("seedReadableLink: failed to write readability file");
  }

  await prisma.link.update({
    where: { id: link.id },
    data: { readable: readablePath },
  });

  return link.id;
}
