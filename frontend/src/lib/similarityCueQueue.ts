import type { SimilarityPairCueData } from "../types/index.ts";

export interface CueQueueState {
	items: SimilarityPairCueData[];
	activeId: string | null;
}

export const emptyCueQueue = (): CueQueueState => ({ items: [], activeId: null });

export function selectCue(queue: CueQueueState, nowBlockIds: readonly string[], enabled: boolean): CueQueueState {
	if (!enabled) return queue;
	const pending = queue.items.filter(cue => !cue.responseStatus || cue.responseStatus === "shown");
	const active = pending.find(cue => cue.id === queue.activeId) ?? pending.find(cue => cue.responseStatus === "shown") ?? pending.find(cue => nowBlockIds.includes(cue.blockId)) ?? pending[0];
	const activeId = active?.id ?? null;
	return activeId === queue.activeId ? queue : { ...queue, activeId };
}

export function hydrateCueQueue(queue: CueQueueState, incoming: SimilarityPairCueData[], now: readonly string[], enabled: boolean): CueQueueState {
	const oldById = new Map(queue.items.map(cue => [cue.id, cue]));
	const unique = new Map(
		incoming.map(cue => {
			const old = oldById.get(cue.id);
			// A slow GET must not undo an action that already succeeded locally.
			const responseStatus = old?.responseStatus && old.responseStatus !== "shown" ? old.responseStatus : cue.responseStatus;
			return [cue.id, { ...cue, responseStatus }] as const;
		})
	);
	const items = [...queue.items.flatMap(cue => (unique.has(cue.id) ? [unique.get(cue.id)!] : [])), ...[...unique.values()].filter(cue => !oldById.has(cue.id))];
	return selectCue({ items, activeId: queue.activeId }, now, enabled);
}

export function respondToCue(queue: CueQueueState, id: string, responseStatus: SimilarityPairCueData["responseStatus"], now: readonly string[], enabled: boolean): CueQueueState {
	return selectCue({ ...queue, items: queue.items.map(cue => (cue.id === id && (!cue.responseStatus || cue.responseStatus === "shown") ? { ...cue, responseStatus } : cue)) }, now, enabled);
}
