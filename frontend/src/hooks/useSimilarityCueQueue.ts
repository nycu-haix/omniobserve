import { useCallback, useEffect, useRef, useState } from "react";
import { emptyCueQueue, hydrateCueQueue, respondToCue, selectCue } from "../lib/similarityCueQueue";
import { apiUrl } from "../services/api";
import type { SimilarityPairCueData } from "../types";

export function useSimilarityCueQueue({
	sessionId,
	participantId,
	enabled,
	isConnected,
	refreshKey,
	nowBlockIds
}: {
	sessionId: string;
	participantId: string;
	enabled: boolean;
	isConnected: boolean;
	refreshKey: number;
	nowBlockIds: string[] | null;
}) {
	const scope = `${sessionId}/${participantId}`;
	const [state, setState] = useState({ scope, queue: emptyCueQueue(), ready: false });
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const nowRevision = useRef(0);
	const context = useRef({ scope, enabled, now: nowBlockIds ?? ([] as string[]) });
	const endpoint = apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/users/${encodeURIComponent(participantId)}/similarity-cues`);
	useEffect(() => {
		nowRevision.current += 1;
		context.current = { scope, enabled, now: nowBlockIds ?? context.current.now };
		const timer = window.setTimeout(
			() => setState(prev => (prev.scope === scope ? { ...prev, queue: selectCue(prev.queue, context.current.now, enabled) } : { scope, queue: emptyCueQueue(), ready: false })),
			0
		);
		return () => window.clearTimeout(timer);
	}, [scope, enabled, nowBlockIds]);

	useEffect(() => {
		if (!isConnected) return;
		let disposed = false;
		let retry: number | undefined;
		const controller = new AbortController();
		async function load() {
			const revision = nowRevision.current;
			try {
				const response = await fetch(endpoint, { signal: controller.signal });
				if (!response.ok) throw new Error(`Cue queue: ${response.status}`);
				const data = (await response.json()) as { cues: SimilarityPairCueData[]; nowBlockIds: string[] };
				if (disposed) return;
				if (revision === nowRevision.current) context.current.now = data.nowBlockIds;
				setState(prev => ({ scope, ready: true, queue: hydrateCueQueue(prev.scope === scope ? prev.queue : emptyCueQueue(), data.cues, context.current.now, context.current.enabled) }));
				setError(null);
			} catch {
				if (!disposed) {
					setError("提示同步失敗，正在重新連線…");
					retry = window.setTimeout(load, 3000);
				}
			}
		}
		void load();
		return () => {
			disposed = true;
			controller.abort();
			window.clearTimeout(retry);
		};
	}, [endpoint, scope, isConnected, refreshKey, enabled, nowBlockIds]);

	const active =
		state.scope === scope && state.ready && enabled && isConnected
			? (state.queue.items.find(cue => cue.id === state.queue.activeId && (!cue.responseStatus || cue.responseStatus === "shown")) ?? null)
			: null;
	const saveResponse = useCallback(
		async (cue: SimilarityPairCueData, response: "shown" | "accepted" | "dismissed" | "shared") => {
			const result = await fetch(`${endpoint}/response`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cueId: cue.cueId || cue.id, response })
			});
			if (!result.ok) throw new Error(`Cue response: ${result.status}`);
			const saved = (await result.json()) as { responseStatus: SimilarityPairCueData["responseStatus"] };
			if (context.current.scope === scope)
				setState(prev => (prev.scope !== scope ? prev : { ...prev, queue: respondToCue(prev.queue, cue.id, saved.responseStatus, context.current.now, context.current.enabled) }));
		},
		[endpoint, scope]
	);

	// Only the mounted, visible cue gets a shown event. Queue arrival is not exposure.
	useEffect(() => {
		if (!active || active.responseStatus === "shown") return;
		let disposed = false;
		let retry: number | undefined;
		async function recordShown() {
			try {
				await saveResponse(active!, "shown");
			} catch {
				if (!disposed) retry = window.setTimeout(recordShown, 3000);
			}
		}
		void recordShown();
		return () => {
			disposed = true;
			window.clearTimeout(retry);
		};
	}, [active, saveResponse]);

	const complete = useCallback(
		async (cue: SimilarityPairCueData, response: "accepted" | "dismissed" | "shared") => {
			if (inFlight.current || !isConnected) return false;
			inFlight.current = true;
			setBusy(true);
			try {
				await saveResponse(cue, response);
				setError(null);
				return true;
			} catch {
				setError("操作尚未儲存，請再試一次。");
				return false;
			} finally {
				inFlight.current = false;
				setBusy(false);
			}
		},
		[isConnected, saveResponse]
	);
	return { active, complete, busy, error };
}
