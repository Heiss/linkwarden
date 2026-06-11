// Fork-owned module (see CLAUDE.md "Downstream Fork Strategy").
//
// Settings UI + state for the YouTube description feature. preference.tsx
// only calls the hook, spreads `payload` into the save request, ORs
// `hasChanges` into its dirty check, and renders the component — keeping the
// upstream file diff minimal.
import { useState, useEffect } from "react";
import { useTranslation } from "next-i18next";
import Checkbox from "@/components/Checkbox";

export type YoutubeDescriptionSettingsController = ReturnType<
  typeof useYoutubeDescriptionSettings
>;

export function useYoutubeDescriptionSettings(account: any) {
  const [enabled, setEnabled] = useState<boolean>(
    account.youtubeDescriptionEnabled ?? false
  );
  const [systemPrompt, setSystemPrompt] = useState<string>(
    account.youtubeDescriptionSystemPrompt ?? ""
  );
  const [describeExistingLinks, setDescribeExistingLinks] = useState<boolean>(
    account.youtubeDescribeExistingLinks ?? false
  );

  useEffect(() => {
    if (Object.keys(account).length === 0) return;
    setEnabled(account.youtubeDescriptionEnabled ?? false);
    setSystemPrompt(account.youtubeDescriptionSystemPrompt ?? "");
    setDescribeExistingLinks(account.youtubeDescribeExistingLinks ?? false);
  }, [account]);

  const hasChanges =
    enabled !== (account.youtubeDescriptionEnabled ?? false) ||
    systemPrompt !== (account.youtubeDescriptionSystemPrompt ?? "") ||
    describeExistingLinks !== (account.youtubeDescribeExistingLinks ?? false);

  const payload = {
    youtubeDescriptionEnabled: enabled,
    youtubeDescriptionSystemPrompt: systemPrompt || null,
    youtubeDescribeExistingLinks: describeExistingLinks,
  };

  return {
    enabled,
    setEnabled,
    systemPrompt,
    setSystemPrompt,
    describeExistingLinks,
    setDescribeExistingLinks,
    hasChanges,
    payload,
  };
}

export default function YoutubeDescriptionSettings({
  controller,
}: {
  controller: YoutubeDescriptionSettingsController;
}) {
  const { t } = useTranslation();
  const {
    enabled,
    setEnabled,
    systemPrompt,
    setSystemPrompt,
    describeExistingLinks,
    setDescribeExistingLinks,
  } = controller;

  return (
    <>
      <div className="mt-5 mb-2">
        <Checkbox
          label={t("youtube_description_enabled")}
          state={enabled}
          onClick={() => setEnabled(!enabled)}
        />
        <p className="text-neutral text-sm pl-5 mb-3">
          {t("youtube_description_enabled_desc")}
        </p>
        <div className={`pl-5 ${!enabled ? "opacity-50" : ""}`}>
          <p className="text-sm mb-1">{t("youtube_description_system_prompt")}</p>
          <textarea
            className="textarea textarea-bordered w-full max-w-screen-sm text-sm font-mono resize-y min-h-[80px]"
            disabled={!enabled}
            placeholder={t("youtube_description_system_prompt_placeholder")}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>
      </div>
      <div className={`mb-3 ${!enabled ? "opacity-50" : ""}`}>
        <Checkbox
          label={t("youtube_describe_existing_links")}
          state={describeExistingLinks}
          onClick={() =>
            enabled && setDescribeExistingLinks(!describeExistingLinks)
          }
          disabled={!enabled}
        />
      </div>
    </>
  );
}
