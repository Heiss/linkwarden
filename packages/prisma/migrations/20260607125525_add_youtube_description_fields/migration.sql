-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "youtubeDescribed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "youtubeDescribeExistingLinks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "youtubeDescriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "youtubeDescriptionSystemPrompt" TEXT;
