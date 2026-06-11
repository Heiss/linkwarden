import { YoutubeTranscript } from "youtube-transcript";
import { prisma } from "@linkwarden/prisma";
import { createFile, readFile } from "@linkwarden/filesystem";
import { Link } from "@linkwarden/prisma/client";
import { ArchivalSettings } from "@linkwarden/types/global";
import { generateText } from "ai";
import { LanguageModelV2 } from "@ai-sdk/provider";
import {
  createOpenAICompatible,
  OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible";
import { perplexity } from "@ai-sdk/perplexity";
import { azure } from "@ai-sdk/azure";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider-v2";

export function getYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SEGMENT_DURATION_MS = 30000; // group every 30 seconds

const ensureValidURL = (base: string, path: string) =>
  `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

const getAIModel = (): LanguageModelV2 | null => {
  try {
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
      const config: OpenAICompatibleProviderSettings = {
        baseURL:
          process.env.CUSTOM_OPENAI_BASE_URL || "https://api.openai.com/v1",
        name: process.env.CUSTOM_OPENAI_NAME || "openai",
        apiKey: process.env.OPENAI_API_KEY,
      };
      return createOpenAICompatible(config)(process.env.OPENAI_MODEL);
    }
    if (
      process.env.AZURE_API_KEY &&
      process.env.AZURE_RESOURCE_NAME &&
      process.env.AZURE_MODEL
    )
      return azure(process.env.AZURE_MODEL);
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL)
      return anthropic(process.env.ANTHROPIC_MODEL);
    if (
      process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT_URL &&
      process.env.OLLAMA_MODEL
    ) {
      const ollama = createOllama({
        baseURL: ensureValidURL(
          process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT_URL,
          "api"
        ),
      });
      return ollama(process.env.OLLAMA_MODEL);
    }
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL) {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter(process.env.OPENROUTER_MODEL) as LanguageModelV2;
    }
    if (process.env.PERPLEXITY_API_KEY) {
      return perplexity(process.env.PERPLEXITY_MODEL || "sonar-pro");
    }
    return null;
  } catch {
    return null;
  }
};

export const DEFAULT_YOUTUBE_DESCRIPTION_PROMPT =
  "You are a helpful assistant. Given a YouTube video transcript, write a concise 2-3 sentence description of what the video is about. Output only the description, no preamble.";

async function callLLMForDescription(
  textContent: string,
  systemPrompt: string
): Promise<string | null> {
  const model = getAIModel();
  if (!model) return null;

  try {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: textContent.slice(0, 3000),
    });
    return text.trim() || null;
  } catch (e) {
    console.error("Failed to generate YouTube description via LLM:", e);
    return null;
  }
}

/**
 * Generates and saves a YouTube description for an already-archived link.
 * Called by the autoDescribeYoutubeLinks worker for existing links.
 */
export async function generateAndSaveYoutubeDescription(
  linkId: number,
  textContent: string,
  readablePath: string,
  systemPrompt: string
): Promise<void> {
  const description = await callLLMForDescription(textContent, systemPrompt);

  if (description) {
    // Update excerpt in the saved readability JSON
    try {
      const fileResult = await readFile(readablePath);
      if (fileResult.status === 200 && fileResult.file) {
        const article = JSON.parse(fileResult.file.toString());
        article.excerpt = description;
        await createFile({
          data: JSON.stringify(article),
          filePath: readablePath,
        });
      }
    } catch (e) {
      console.error("Failed to update readability JSON with description:", e);
    }

    await prisma.link.update({
      where: { id: linkId },
      data: { description, youtubeDescribed: true },
    });
  } else {
    // Mark as processed even on failure so the worker doesn't retry forever
    await prisma.link.update({
      where: { id: linkId },
      data: { youtubeDescribed: true },
    });
  }
}

/**
 * Pre-archival hook called from archiveHandler.ts before browser navigation.
 * For YouTube links it disables the formats that don't make sense (screenshot,
 * PDF, monolith — mutating archivalSettings in place) and archives the
 * transcript as the readable format. Returns true when the transcript was
 * archived, so the caller skips its own readability extraction. No-op (false)
 * for non-YouTube links.
 */
export async function preArchiveYoutube(
  link: Link,
  user:
    | {
        youtubeDescriptionEnabled?: boolean | null;
        youtubeDescriptionSystemPrompt?: string | null;
      }
    | null
    | undefined,
  archivalSettings: ArchivalSettings
): Promise<boolean> {
  if (!link.url || getYouTubeVideoId(link.url) === null) return false;

  archivalSettings.archiveAsScreenshot = false;
  archivalSettings.archiveAsPDF = false;
  archivalSettings.archiveAsMonolith = false;

  if (archivalSettings.archiveAsReadable && !link.readable) {
    return await handleYoutubeTranscript(
      link,
      user?.youtubeDescriptionEnabled ?? false,
      user?.youtubeDescriptionSystemPrompt ?? null
    );
  }

  return false;
}

const handleYoutubeTranscript = async (
  link: Link,
  descriptionEnabled: boolean,
  systemPrompt: string | null
): Promise<boolean> => {
  const TEXT_CONTENT_LIMIT = Number(process.env.TEXT_CONTENT_LIMIT) || 0;

  if (!link.url) return false;

  const videoId = getYouTubeVideoId(link.url);
  if (!videoId) return false;

  let transcriptItems: { text: string; duration: number; offset: number }[];
  try {
    transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (e) {
    console.error("Failed to fetch YouTube transcript:", e);
    return false;
  }

  if (!transcriptItems || transcriptItems.length === 0) return false;

  // Group items into ~30-second paragraphs with clickable timestamp spans
  const paragraphs: string[] = [];
  let currentTexts: string[] = [];
  let segmentStart = transcriptItems[0].offset;

  for (const item of transcriptItems) {
    if (
      currentTexts.length > 0 &&
      item.offset - segmentStart >= SEGMENT_DURATION_MS
    ) {
      const timestamp = formatTime(segmentStart / 1000);
      paragraphs.push(
        `<p><span class="transcript-timestamp" data-offset="${segmentStart}" style="cursor:pointer;opacity:0.5;font-size:0.8em;margin-right:0.4em;">[${timestamp}]</span>${escapeHtml(decodeHtmlEntities(currentTexts.join(" ")))}</p>`
      );
      currentTexts = [];
      segmentStart = item.offset;
    }
    if (currentTexts.length === 0) segmentStart = item.offset;
    currentTexts.push(decodeHtmlEntities(item.text));
  }

  if (currentTexts.length > 0) {
    const timestamp = formatTime(segmentStart / 1000);
    paragraphs.push(
      `<p><span class="transcript-timestamp" data-offset="${segmentStart}" style="cursor:pointer;opacity:0.5;font-size:0.8em;margin-right:0.4em;">[${timestamp}]</span>${escapeHtml(currentTexts.join(" "))}</p>`
    );
  }

  const content = paragraphs.join("\n");
  const textContent = transcriptItems
    .map((item) => decodeHtmlEntities(item.text))
    .join(" ")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, TEXT_CONTENT_LIMIT || undefined);

  const collectionId = (
    await prisma.link.findUnique({
      where: { id: link.id },
      select: { collectionId: true },
    })
  )?.collectionId;

  if (!collectionId) return false;

  const resolvedPrompt =
    systemPrompt?.trim() || DEFAULT_YOUTUBE_DESCRIPTION_PROMPT;

  const description = descriptionEnabled
    ? await callLLMForDescription(textContent, resolvedPrompt)
    : null;

  const article = {
    title: link.name || "",
    content,
    textContent,
    byline: null,
    excerpt: description,
    siteName: "YouTube",
  };

  const readablePath = `archives/${collectionId}/${link.id}_readability.json`;

  await createFile({
    data: JSON.stringify(article),
    filePath: readablePath,
  });

  await prisma.link.update({
    where: { id: link.id },
    data: {
      readable: readablePath,
      textContent,
      youtubeDescribed: true,
      ...(description ? { description } : {}),
    },
  });

  return true;
};

export default handleYoutubeTranscript;
