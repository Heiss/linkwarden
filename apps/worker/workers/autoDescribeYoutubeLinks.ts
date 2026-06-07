import { delay } from "@linkwarden/lib/utils";
import { prisma } from "@linkwarden/prisma";
import {
  generateAndSaveYoutubeDescription,
  DEFAULT_YOUTUBE_DESCRIPTION_PROMPT,
  getYouTubeVideoId,
} from "../lib/preservationScheme/handleYoutubeTranscript";

const TAKE_COUNT = Number(process.env.ARCHIVE_TAKE_COUNT || "") || 5;

const hasAiProvider = () =>
  Boolean(
    process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT_URL ||
      process.env.OPENAI_API_KEY ||
      process.env.AZURE_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.PERPLEXITY_API_KEY
  );

export async function autoDescribeYoutubeLinks(interval = 10) {
  if (!hasAiProvider()) return;

  console.log(
    "\x1b[34m%s\x1b[0m",
    "Starting YouTube description worker..."
  );

  while (true) {
    const links = await prisma.link.findMany({
      where: {
        youtubeDescribed: false,
        readable: { not: null },
        OR: [
          { url: { contains: "youtube.com" } },
          { url: { contains: "youtu.be" } },
        ],
        collection: {
          owner: {
            youtubeDescriptionEnabled: true,
          },
        },
      },
      include: {
        collection: { include: { owner: true } },
      },
      take: TAKE_COUNT,
      orderBy: { lastPreserved: "desc" },
    });

    if (links.length === 0) {
      await delay(interval);
      continue;
    }

    await Promise.allSettled(
      links.map(async (link) => {
        // Double-check it's actually a YouTube URL
        if (!link.url || !getYouTubeVideoId(link.url)) {
          await prisma.link.update({
            where: { id: link.id },
            data: { youtubeDescribed: true },
          });
          return;
        }

        if (!link.textContent || !link.readable) {
          await prisma.link.update({
            where: { id: link.id },
            data: { youtubeDescribed: true },
          });
          return;
        }

        const owner = link.collection.owner;
        const systemPrompt =
          owner.youtubeDescriptionSystemPrompt?.trim() ||
          DEFAULT_YOUTUBE_DESCRIPTION_PROMPT;

        try {
          console.log(
            "\x1b[34m%s\x1b[0m",
            `Generating YouTube description for link ${link.url} (user ${owner.id})`
          );
          await generateAndSaveYoutubeDescription(
            link.id,
            link.textContent,
            link.readable,
            systemPrompt
          );
          console.log(
            "\x1b[34m%s\x1b[0m",
            `Done generating description for ${link.url}`
          );
        } catch (err) {
          console.error(
            "\x1b[34m%s\x1b[0m",
            `Error generating description for ${link.url}:`,
            err
          );
          await prisma.link.update({
            where: { id: link.id },
            data: { youtubeDescribed: true },
          });
        }
      })
    );

    await delay(interval);
  }
}
