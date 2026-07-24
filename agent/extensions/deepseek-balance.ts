/**
 * DeepSeek account balance widget (below editor).
 *
 * Only active when the current model provider is "deepseek".
 * Polls https://api.deepseek.com/user/balance every 10 minutes.
 *
 * Display:
 *   success: DeepSeek: 110.00 CNY[ | 15.00 USD...]
 *   stale:   <success> (stale)
 *   placeholder / unavailable / empty / error-without-cache: DeepSeek: 0 CNY
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const PROVIDER = "deepseek";
const WIDGET_ID = "deepseek-balance";
const INTERVAL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const PLACEHOLDER = "DeepSeek: 0 CNY";

type BalanceInfo = {
	currency: string;
	total_balance: string;
	granted_balance?: string;
	topped_up_balance?: string;
};

type BalanceResponse = {
	is_available: boolean;
	balance_infos?: BalanceInfo[];
};

type Ui = ExtensionContext["ui"];
type Registry = ExtensionContext["modelRegistry"];

export default function (pi: ExtensionAPI) {
	let ui: Ui | null = null;
	let registry: Registry | null = null;
	let active = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let abort: AbortController | null = null;
	let fetchGen = 0;
	/** Last successful non-placeholder line, e.g. "DeepSeek: 110.00 CNY". */
	let cache: string | null = null;
	/** Current display text (without theme); factory re-reads this on render. */
	let display: string | null = null;

	function setLine(line: string | undefined) {
		if (!ui) return;
		if (line === undefined) {
			display = null;
			ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		display = line;
		// dim — same tone as footer token/cost line
		ui.setWidget(
			WIDGET_ID,
			(_tui, theme) => new Text(theme.fg("dim", display ?? ""), 0, 0),
			{ placement: "belowEditor" },
		);
	}

	function formatSuccess(infos: BalanceInfo[]): string {
		const parts = infos.map((i) => `${i.total_balance} ${i.currency}`);
		return `DeepSeek: ${parts.join(" | ")}`;
	}

	function showFailure() {
		if (!active) return;
		if (cache) setLine(`${cache} (stale)`);
		else setLine(PLACEHOLDER);
	}

	function stop() {
		active = false;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (abort) {
			abort.abort();
			abort = null;
		}
		fetchGen++;
		setLine(undefined);
	}

	async function refresh() {
		if (!active || !ui || !registry) return;

		const apiKey = await registry.getApiKeyForProvider(PROVIDER);
		if (!apiKey) {
			// No key: hide and stop polling (decision 16).
			stop();
			return;
		}

		// First load / no cache yet: show placeholder immediately (decision 13).
		if (cache === null) setLine(PLACEHOLDER);

		if (abort) abort.abort();
		const controller = new AbortController();
		abort = controller;
		const gen = ++fetchGen;

		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const res = await fetch(BALANCE_URL, {
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				signal: controller.signal,
			});

			if (gen !== fetchGen || !active) return;

			if (!res.ok) {
				showFailure();
				return;
			}

			let data: BalanceResponse;
			try {
				data = (await res.json()) as BalanceResponse;
			} catch {
				if (gen !== fetchGen || !active) return;
				showFailure();
				return;
			}

			if (gen !== fetchGen || !active) return;

			// is_available:false → force placeholder; keep success cache (decisions 15, 21).
			if (!data.is_available) {
				setLine(PLACEHOLDER);
				return;
			}

			const infos = data.balance_infos ?? [];
			if (infos.length === 0) {
				// Empty infos → placeholder; do not overwrite cache.
				setLine(PLACEHOLDER);
				return;
			}

			const line = formatSuccess(infos);
			cache = line;
			setLine(line);
		} catch {
			// Abort on switch-away is ignored via gen/active checks.
			if (gen !== fetchGen || !active) return;
			showFailure();
		} finally {
			clearTimeout(timeout);
			if (abort === controller) abort = null;
		}
	}

	function start(ctx: ExtensionContext) {
		ui = ctx.ui;
		registry = ctx.modelRegistry;
		active = true;
		// Re-entry with cache: show it immediately while refresh is in flight.
		if (cache) setLine(cache);
		if (timer) clearInterval(timer);
		timer = setInterval(() => {
			void refresh();
		}, INTERVAL_MS);
		void refresh();
	}

	function isDeepseek(model: { provider?: string } | undefined | null): boolean {
		return model?.provider === PROVIDER;
	}

	function bindCtx(ctx: ExtensionContext) {
		ui = ctx.ui;
		registry = ctx.modelRegistry;
	}

	pi.on("session_start", async (_event, ctx) => {
		bindCtx(ctx);
		if (isDeepseek(ctx.model)) start(ctx);
		else stop();
	});

	pi.on("model_select", async (event, ctx) => {
		bindCtx(ctx);
		if (isDeepseek(event.model)) start(ctx);
		else stop();
	});

	pi.on("session_shutdown", async () => {
		stop();
		ui = null;
		registry = null;
	});
}
