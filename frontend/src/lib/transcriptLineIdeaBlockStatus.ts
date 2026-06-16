import type { IdeaBlock, TranscriptLine } from "../types";

function ideaBlockTranscriptLineIds(block: IdeaBlock): string[] {
	return [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
}

export function getIdeaBlockTranscriptLineIdsForBlockIds(blocks: IdeaBlock[], blockIds: Set<string>): Set<string> {
	const transcriptLineIds = new Set<string>();
	blocks.forEach(block => {
		if (!blockIds.has(block.id)) {
			return;
		}
		ideaBlockTranscriptLineIds(block).forEach(transcriptLineId => transcriptLineIds.add(transcriptLineId));
	});
	return transcriptLineIds;
}

export function hasReadyIdeaBlockForTranscriptLineIds(blocks: IdeaBlock[], transcriptLineIds: Set<string>): boolean {
	if (transcriptLineIds.size === 0) {
		return false;
	}

	return blocks.some(block => {
		if (block.status !== "ready" || block.isDeleted) {
			return false;
		}
		return ideaBlockTranscriptLineIds(block).some(transcriptLineId => transcriptLineIds.has(transcriptLineId));
	});
}

export function markTranscriptLinesIdeaBlockStatus<T extends TranscriptLine>(lines: T[], transcriptLineIds: Set<string>, ideaBlockStatus: TranscriptLine["ideaBlockStatus"]): T[] {
	if (transcriptLineIds.size === 0) {
		return lines;
	}

	let didChange = false;
	const nextLines = lines.map(line => {
		if (line.source !== "private" || !transcriptLineIds.has(line.id)) {
			return line;
		}
		if (line.ideaBlockStatus === ideaBlockStatus && !line.linkedBlockId) {
			return line;
		}
		didChange = true;
		return {
			...line,
			linkedBlockId: undefined,
			ideaBlockStatus
		};
	});
	return didChange ? nextLines : lines;
}

export function clearPendingTranscriptLinesIdeaBlockStatus<T extends TranscriptLine>(lines: T[], transcriptLineIds: Set<string>): T[] {
	if (transcriptLineIds.size === 0) {
		return lines;
	}

	let didChange = false;
	const nextLines = lines.map(line => {
		if (line.source !== "private" || !transcriptLineIds.has(line.id) || line.ideaBlockStatus !== "pending") {
			return line;
		}

		didChange = true;
		return {
			...line,
			linkedBlockId: undefined,
			ideaBlockStatus: undefined
		};
	});
	return didChange ? nextLines : lines;
}
