import { z } from "zod";

// Fork-owned module (see CLAUDE.md "Downstream Fork Strategy").
// Zod fields for the YouTube description feature, spread into
// UpdateUserSchema in schemaValidation.ts so the upstream file only carries
// a one-line spread.
export const YoutubeDescriptionUserSchemaFields = {
  youtubeDescriptionEnabled: z.boolean().optional(),
  youtubeDescriptionSystemPrompt: z.string().max(2000).nullish(),
  youtubeDescribeExistingLinks: z.boolean().optional(),
};
