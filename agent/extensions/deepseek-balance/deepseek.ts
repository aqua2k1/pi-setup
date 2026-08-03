/**
 * DeepSeek balance source — https://api.deepseek.com/user/balance
 */

import { HttpError, type WidgetSource } from "./source.js";

const DEEPSEEK_PROVIDER = "deepseek";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEEPSEEK_PLACEHOLDER = "DeepSeek: 0 CNY";

type BalanceInfo = {
	currency: string;
	total_balance: string;
};

type BalanceResponse = {
	is_available: boolean;
	balance_infos?: BalanceInfo[];
};

export const deepseekSource: WidgetSource = {
	provider: DEEPSEEK_PROVIDER,
	placeholder: DEEPSEEK_PLACEHOLDER,
	async fetch(apiKey, signal) {
		const res = await fetch(DEEPSEEK_BALANCE_URL, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			signal,
		});
		if (!res.ok) throw new HttpError(res.status);

		const data = (await res.json()) as BalanceResponse;
		// is_available:false → 无数据（占位，不覆盖缓存）。
		if (!data.is_available) return undefined;
		const infos = data.balance_infos ?? [];
		if (infos.length === 0) return undefined;

		const line = `DeepSeek: ${infos.map((i) => `${i.total_balance} ${i.currency}`).join(" | ")}`;
		return { line, windows: [] };
	},
	// 余额暂无预警规则（可后续加：余额低于阈值）。
	isWarning: () => false,
};
