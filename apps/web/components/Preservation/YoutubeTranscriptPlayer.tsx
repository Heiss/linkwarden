// Fork-owned module (see CLAUDE.md "Downstream Fork Strategy").
//
// Inline YouTube player with transcript sync for the reader view. The
// transcript HTML produced by the worker (handleYoutubeTranscript.ts) contains
// [data-offset] timestamp spans; this module embeds the video, highlights the
// paragraph matching the current playback position, and seeks the player when
// a timestamp is clicked. ReadableView.tsx only calls the hook and renders the
// component — all state and effects live here to keep the upstream file diff
// minimal.
import { useEffect, useRef, useState } from "react";

export function getYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export type YoutubeTranscriptPlayerController = ReturnType<
  typeof useYoutubeTranscriptPlayer
>;

export function useYoutubeTranscriptPlayer(
  url: string | null | undefined,
  highlightedHtml: string
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastHighlightedPRef = useRef<HTMLElement | null>(null);
  const currentTimeMsRef = useRef(0);
  const seekTargetMsRef = useRef<number | null>(null);

  const videoId = url ? getYouTubeVideoId(url) : null;
  const [iframeSrc, setIframeSrc] = useState(
    videoId
      ? `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`
      : ""
  );

  const updateTranscriptHighlight = (currentMs: number) => {
    const container = document.getElementById("readable-view");
    if (!container) return;

    const spans = Array.from(
      container.querySelectorAll<HTMLElement>("[data-offset]")
    );
    if (spans.length === 0) return;

    let activeSpan: HTMLElement | null = null;
    for (const span of spans) {
      if (Number(span.dataset.offset) <= currentMs) activeSpan = span;
      else break;
    }

    const activeP = (activeSpan?.closest("p") as HTMLElement) ?? null;
    if (activeP === lastHighlightedPRef.current) return;

    if (lastHighlightedPRef.current) {
      lastHighlightedPRef.current.style.backgroundColor = "";
    }
    if (activeP) {
      activeP.style.backgroundColor = "oklch(var(--b3))";
    }
    lastHighlightedPRef.current = activeP;
  };

  // Re-apply active highlight after content re-renders (dangerouslySetInnerHTML wipes inline styles)
  useEffect(() => {
    lastHighlightedPRef.current = null;
    updateTranscriptHighlight(currentTimeMsRef.current);
  }, [highlightedHtml]);

  // Subscribe to YouTube infoDelivery events to track playback position
  useEffect(() => {
    if (!videoId) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (
          data.event === "infoDelivery" &&
          typeof data.info?.currentTime === "number"
        ) {
          const newMs = data.info.currentTime * 1000;
          // After a seek, ignore stale events that are far from the target
          // (YouTube often fires an initial event at t≈0 before the seek takes effect)
          if (seekTargetMsRef.current !== null) {
            if (Math.abs(newMs - seekTargetMsRef.current) > 3000) return;
            seekTargetMsRef.current = null;
          }
          currentTimeMsRef.current = newMs;
          updateTranscriptHighlight(currentTimeMsRef.current);
        }
      } catch {}
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [videoId]);

  // Tell YouTube to send infoDelivery events after the iframe loads/reloads
  const handleIframeLoad = () => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: 1 }),
      "*"
    );
  };

  const seekToTime = (offsetMs: number) => {
    if (!videoId) return;
    const seconds = Math.floor(offsetMs / 1000);
    // Immediately show the correct highlight so it's not cleared by a stale
    // infoDelivery event (YouTube often emits currentTime≈0 when the iframe reloads)
    seekTargetMsRef.current = offsetMs;
    currentTimeMsRef.current = offsetMs;
    updateTranscriptHighlight(offsetMs);
    setIframeSrc(
      `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&start=${seconds}&autoplay=1`
    );
  };

  // Returns true when the click hit a transcript timestamp and was consumed
  // (the caller should then skip its own click handling, e.g. highlights).
  const handleTranscriptClick = (target: HTMLElement): boolean => {
    if (!videoId) return false;
    const offsetEl = target.closest("[data-offset]") as HTMLElement | null;
    if (offsetEl?.dataset.offset !== undefined) {
      seekToTime(Number(offsetEl.dataset.offset));
      return true;
    }
    return false;
  };

  const jumpToCurrent = () =>
    lastHighlightedPRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

  return {
    videoId,
    iframeRef,
    iframeSrc,
    handleIframeLoad,
    handleTranscriptClick,
    jumpToCurrent,
  };
}

export default function YoutubeTranscriptPlayer({
  controller,
}: {
  controller: YoutubeTranscriptPlayerController;
}) {
  if (!controller.videoId) return null;

  return (
    <div className="sticky top-0 z-10 w-full bg-base-200 pb-2 pt-2">
      <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
        <iframe
          ref={controller.iframeRef}
          src={controller.iframeSrc}
          onLoad={controller.handleIframeLoad}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 w-full h-full rounded-lg"
        />
      </div>
      <div className="flex justify-end mt-1 px-1">
        <button
          onClick={controller.jumpToCurrent}
          className="text-xs flex items-center gap-1 opacity-60 hover:opacity-100 duration-150"
          title="Jump to current transcript position"
        >
          <i className="bi-arrow-down-circle" />
          Jump to current
        </button>
      </div>
    </div>
  );
}
