import { expect, test } from "../../index";
import {
  seedReadableLink,
  READER_EXTERNAL_TARGET,
  READER_RELATIVE_HREF,
  READER_ARTICLE_URL,
} from "@/e2e/data/readerLink";

test.describe(
  "Reader view",
  {
    tag: "@reader-view",
  },
  () => {
    let linkId: number;

    test.beforeAll(async () => {
      linkId = await seedReadableLink(process.env["TEST_USERNAME"] || "");
    });

    test("article links are rewritten to open natively in a new tab", async ({
      page,
    }) => {
      await page.goto(`/preserved/${linkId}?format=3`);

      const external = page.locator("#readable-view a#e2e-external-link");
      await expect(external).toBeVisible();
      await expect(external).toHaveAttribute("href", READER_EXTERNAL_TARGET);
      await expect(external).toHaveAttribute("target", "_blank");
      await expect(external).toHaveAttribute("rel", "noopener noreferrer");

      // Relative hrefs must be resolved against the article URL, otherwise
      // they would point into the Linkwarden app itself.
      const relative = page.locator("#readable-view a#e2e-relative-link");
      await expect(relative).toHaveAttribute(
        "href",
        new URL(READER_RELATIVE_HREF, READER_ARTICLE_URL).href
      );
      await expect(relative).toHaveAttribute("target", "_blank");
    });

    test("clicking an article link opens a new tab and does not scroll or navigate the reader", async ({
      page,
    }) => {
      await page.goto(`/preserved/${linkId}?format=3`);

      const external = page.locator("#readable-view a#e2e-external-link");
      await expect(external).toBeVisible();

      // Give the reader some scroll offset while keeping the link in view, so
      // a regression that scrolls the page on click is detectable.
      const scrollBefore = await page.evaluate(() => {
        const container = document.querySelector(
          "div.overflow-y-auto"
        ) as HTMLElement;
        container.scrollTop = 40;
        return container.scrollTop;
      });

      const urlBefore = page.url();
      const popupPromise = page.context().waitForEvent("page");
      await external.click();
      const popup = await popupPromise;

      // A popup opening at all proves the native target="_blank" navigation
      // ran (its destination is pinned by the href assertions above). Don't
      // require the external page to actually load — CI may be offline, which
      // would leave the popup on an error page.
      await popup
        .waitForURL(READER_EXTERNAL_TARGET, { waitUntil: "commit" })
        .catch(() => {});
      expect(popup.url()).not.toContain("localhost:3000");
      await popup.close();

      // The reader itself must stay where it was: same URL, same scroll
      // position (the original bug swallowed the click and nudged the scroll).
      expect(page.url()).toBe(urlBefore);
      const scrollAfter = await page.evaluate(
        () =>
          (document.querySelector("div.overflow-y-auto") as HTMLElement)
            .scrollTop
      );
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(1);
    });
  }
);
