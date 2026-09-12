import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AVAILABLE_SKILLS_OPEN = "<available_skills>";
const AVAILABLE_SKILLS_CLOSE = "</available_skills>";
const SKILLS_INTRO =
  "\n\nThe following skills provide specialized instructions for specific tasks.";
const DEFAULT_HIDE_SKILLS = true;

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
  let hideSkills = DEFAULT_HIDE_SKILLS;

  pi.registerCommand("hide-skills", {
    description:
      "Toggle hiding available skills. Usage: /hide-skills [on|off|status]",
    handler: async (args, ctx) => {
      const option = args.trim().toLowerCase();

      if (option === "status") {
        ctx.ui.notify(
          `hide-skills: ${hideSkills ? "enabled" : "disabled"}`,
          "info",
        );
        return;
      }

      if (option === "" || option === "toggle") {
        hideSkills = !hideSkills;
      } else if (option === "on" || option === "enable") {
        hideSkills = true;
      } else if (option === "off" || option === "disable") {
        hideSkills = false;
      } else {
        ctx.ui.notify(
          'Usage: /hide-skills [on|off|status] ("on" hides the skill list)',
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        `hide-skills: ${hideSkills ? "enabled" : "disabled"}`,
        "info",
      );
    },
  });

  pi.on("before_agent_start", (event) => {
    if (!hideSkills) {
      return;
    }

    const nextPrompt = hideAvailableSkills(event.systemPrompt);
    if (nextPrompt === event.systemPrompt) {
      return;
    }

    return { systemPrompt: nextPrompt };
  });
}
