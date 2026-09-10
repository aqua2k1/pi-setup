import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AVAILABLE_SKILLS_OPEN = "<available_skills>";
const AVAILABLE_SKILLS_CLOSE = "</available_skills>";
const SKILLS_INTRO =
  "\n\nThe following skills provide specialized instructions for specific tasks.";

function hideAvailableSkills(systemPrompt: string): string {
  const openingIndex = systemPrompt.indexOf(AVAILABLE_SKILLS_OPEN);
  if (openingIndex === -1) {
    return systemPrompt;
  }

  const closingIndex = systemPrompt.indexOf(
    AVAILABLE_SKILLS_CLOSE,
    openingIndex,
  );
  if (closingIndex === -1) {
    return systemPrompt;
  }

  const sectionStart = systemPrompt.lastIndexOf(SKILLS_INTRO, openingIndex);
  const replacementStart = sectionStart >= 0 ? sectionStart : openingIndex;
  const replacementEnd = closingIndex + AVAILABLE_SKILLS_CLOSE.length;

  return `${systemPrompt.slice(0, replacementStart)}${systemPrompt.slice(replacementEnd)}`;
}

export default function hideSkillsExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const nextPrompt = hideAvailableSkills(event.systemPrompt);
    if (nextPrompt === event.systemPrompt) {
      return;
    }

    return { systemPrompt: nextPrompt };
  });
}
