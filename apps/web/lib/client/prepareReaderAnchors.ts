// Fork-owned helper (see CLAUDE.md "Downstream Fork Strategy").
//
// Make in-article anchors open in a new tab natively. Relying on a JS click
// handler + window.open is unreliable: the browser's popup blocker can drop
// the window.open while preventDefault has already cancelled the navigation,
// so clicking a link does nothing. A native target="_blank" anchor is never
// popup-blocked. We also resolve relative hrefs against the article URL so
// links that were stored relative still point somewhere.
export default function prepareReaderAnchors(
  container: HTMLElement,
  baseUrl?: string | null
) {
  const anchors = container.querySelectorAll<HTMLAnchorElement>("a[href]");
  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    try {
      anchor.setAttribute("href", new URL(href, baseUrl || undefined).href);
    } catch {
      // leave the original href untouched if it can't be resolved
    }

    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
}
