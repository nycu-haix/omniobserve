import type { IdeaBlock, TranscriptLine } from "../types";

export type TranscriptIdeaBlockStatus = "raw" | "captured" | "pending" | "linked" | "no_idea" | "failed";

function isReadyIdeaBlock(block: IdeaBlock): boolean {
	return block.status !== "generating" && !block.isDeleted;
}

function isPendingIdeaBlock(block: IdeaBlock): boolean {
	return block.status === "generating" && !block.isDeleted;
}

function blockTranscriptIds(block: IdeaBlock): string[] {
	return [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
}

function isTerminalTranscriptIdeaBlockStatus(line: TranscriptLine): boolean {
	return line.ideaBlockStatus === "no_idea" || line.ideaBlockStatus === "failed";
}

function blockMatchesTranscriptLine(block: IdeaBlock, line: TranscriptLine, options: { allowTextMatch?: boolean } = {}): boolean {
	if (blockTranscriptIds(block).some(transcriptId => transcriptId === line.id)) {
		return true;
	}

	if (options.allowTextMatch === false) {
		return false;
	}

	const transcriptText = block.transcript?.trim();
	return !!transcriptText && transcriptText === line.text.trim();
}

export function getTranscriptIdeaBlockTargetId(line: TranscriptLine, blocks: IdeaBlock[]): string | null {
	if (line.source !== "private") {
		return null;
	}

	if (line.linkedBlockId) {
		const linkedBlock = blocks.find(block => block.id === line.linkedBlockId);
		if (linkedBlock && isReadyIdeaBlock(linkedBlock)) {
			return linkedBlock.id;
		}
	}

	const matchingReadyBlock = blocks.find(block => isReadyIdeaBlock(block) && blockMatchesTranscriptLine(block, line, { allowTextMatch: !isTerminalTranscriptIdeaBlockStatus(line) }));
	return matchingReadyBlock?.id ?? null;
}

export function getTranscriptIdeaBlockStatus(line: TranscriptLine, blocks: IdeaBlock[]): TranscriptIdeaBlockStatus {
	if (line.source !== "private") {
		return "raw";
	}

	if (getTranscriptIdeaBlockTargetId(line, blocks)) {
		return "linked";
	}

	const matchingPendingBlock = blocks.find(block => isPendingIdeaBlock(block) && blockMatchesTranscriptLine(block, line));
	if (matchingPendingBlock) {
		return "pending";
	}

	return line.ideaBlockStatus ?? "raw";
}

export function linkTranscriptLinesToReadyBlocks<T extends TranscriptLine>(lines: T[], blocks: IdeaBlock[]): T[] {
	let didChange = false;
	const linkedLines = lines.map(line => {
		const targetBlockId = getTranscriptIdeaBlockTargetId(line, blocks);

		if (!targetBlockId) {
			if (!line.linkedBlockId) {
				return line;
			}

			didChange = true;
			return {
				...line,
				linkedBlockId: undefined
			};
		}

		if (line.linkedBlockId === targetBlockId && !line.ideaBlockStatus) {
			return line;
		}

		didChange = true;
		return {
			...line,
			linkedBlockId: targetBlockId,
			ideaBlockStatus: undefined
		};
	});

	return didChange ? linkedLines : lines;
}
