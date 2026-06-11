// Fork-owned module (see CLAUDE.md "Downstream Fork Strategy").
//
// Server-side pieces of the YouTube description feature that hook into
// updateUserById.ts. Kept here so the upstream controller only needs a
// one-line spread and a one-line call.
import { prisma } from "@linkwarden/prisma";

type YoutubeDescriptionData = {
  youtubeDescriptionEnabled?: boolean;
  youtubeDescriptionSystemPrompt?: string | null;
  youtubeDescribeExistingLinks?: boolean;
};

// Fields merged into the prisma.user.update() data object.
export function youtubeDescriptionUserFields(data: YoutubeDescriptionData) {
  return {
    youtubeDescriptionEnabled: data.youtubeDescriptionEnabled,
    youtubeDescriptionSystemPrompt: data.youtubeDescriptionSystemPrompt,
    youtubeDescribeExistingLinks: data.youtubeDescribeExistingLinks,
  };
}

// When the user first enables "describe existing links", reset youtubeDescribed
// on their YouTube links so the worker picks them up
export async function resetYoutubeDescribedIfEnabled(
  userId: number,
  data: YoutubeDescriptionData,
  user: { youtubeDescribeExistingLinks: boolean } | null | undefined
) {
  if (
    data.youtubeDescribeExistingLinks === true &&
    !user?.youtubeDescribeExistingLinks
  ) {
    await prisma.link.updateMany({
      where: {
        createdById: userId,
        youtubeDescribed: true,
        readable: { not: null },
        OR: [
          { url: { contains: "youtube.com" } },
          { url: { contains: "youtu.be" } },
        ],
      },
      data: { youtubeDescribed: false },
    });
  }
}
