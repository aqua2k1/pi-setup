/**
 * Searchable string picker for extension UI - mirrors /model UX:
 * type to fuzzy-filter, arrow keys navigate a short visible window, Enter selects.
 *
 * Filtering uses pi-tui's native fuzzyFilter (same as /model). This module is
 * loaded only under pi (jiti resolves @earendil-works/*); its TUI behavior is
 * not unit-tested in isolation. The surrounding /subagent-model flow is
 * covered by ui.test.ts via a stub UI.
 */

import {
  DynamicBorder,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  Input,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

const MAX_VISIBLE = 10;

/**
 * Open a searchable select dialog via ctx.ui.custom.
 * Returns the chosen option, or undefined if cancelled.
 */
export async function showSearchableSelect(
  ui: Pick<ExtensionUIContext, "custom">,
  title: string,
  options: string[],
): Promise<string | undefined> {
  const result = await ui.custom<string | undefined>(
    (tui, theme, keybindings, done) => {
      const root = new Container();
      const searchInput = new Input();
      const listContainer = new Container();
      let filtered = options.slice();
      let selectedIndex = 0;
      let focused = false;

      const accent = (t: string) => theme.fg("accent", t);
      const muted = (t: string) => theme.fg("muted", t);
      const dim = (t: string) => theme.fg("dim", t);
      const text = (t: string) => theme.fg("text", t);

      function updateList() {
        listContainer.clear();
        if (filtered.length === 0) {
          listContainer.addChild(new Text(muted("  No matching models"), 1, 0));
          return;
        }
        const start = Math.max(
          0,
          Math.min(
            selectedIndex - Math.floor(MAX_VISIBLE / 2),
            filtered.length - MAX_VISIBLE,
          ),
        );
        const end = Math.min(start + MAX_VISIBLE, filtered.length);
        for (const [offset, item] of filtered.slice(start, end).entries()) {
          const i = start + offset;
          const line =
            i === selectedIndex ? accent(`→ ${item}`) : `  ${text(item)}`;
          listContainer.addChild(new Text(line, 1, 0));
        }
        if (start > 0 || end < filtered.length) {
          listContainer.addChild(
            new Text(
              muted(`  (${selectedIndex + 1}/${filtered.length})`),
              1,
              0,
            ),
          );
        }
      }

      function applyFilter() {
        filtered = fuzzyFilter(options, searchInput.getValue(), (s) => s);
        selectedIndex = Math.min(
          selectedIndex,
          Math.max(0, filtered.length - 1),
        );
        updateList();
      }

      function pick() {
        const chosen = filtered[selectedIndex];
        if (chosen !== undefined) done(chosen);
      }

      searchInput.onSubmit = () => pick();

      root.addChild(new DynamicBorder((s) => accent(s)));
      root.addChild(new Spacer(1));
      root.addChild(new Text(accent(theme.bold(title)), 1, 0));
      root.addChild(new Spacer(1));
      root.addChild(searchInput);
      root.addChild(new Spacer(1));
      root.addChild(listContainer);
      root.addChild(new Spacer(1));
      root.addChild(
        new Text(
          dim("type to search • ↑↓ navigate • enter select • esc cancel"),
          1,
          0,
        ),
      );
      root.addChild(new Spacer(1));
      root.addChild(new DynamicBorder((s) => accent(s)));

      updateList();

      return {
        get focused() {
          return focused;
        },
        set focused(value: boolean) {
          focused = value;
          searchInput.focused = value;
        },
        render: (w: number) => root.render(w),
        invalidate: () => root.invalidate(),
        handleInput: (data: string) => {
          if (keybindings.matches(data, "tui.select.up")) {
            if (filtered.length === 0) return;
            selectedIndex =
              selectedIndex === 0 ? filtered.length - 1 : selectedIndex - 1;
            updateList();
            tui.requestRender();
            return;
          }
          if (keybindings.matches(data, "tui.select.down")) {
            if (filtered.length === 0) return;
            selectedIndex =
              selectedIndex === filtered.length - 1 ? 0 : selectedIndex + 1;
            updateList();
            tui.requestRender();
            return;
          }
          if (keybindings.matches(data, "tui.select.confirm")) {
            pick();
            return;
          }
          if (keybindings.matches(data, "tui.select.cancel")) {
            done(undefined);
            return;
          }
          searchInput.handleInput(data);
          applyFilter();
          tui.requestRender();
        },
      };
    },
  );

  return result ?? undefined;
}
