export type LatestTranscriptIdeaBlockStatus = "captured" | "pending" | "generated" | "no_idea" | "failed";

export interface LatestTranscriptIdeaBlockStatusState {
	transcriptSegmentId: string | null;
	ideaBlockStatus: LatestTranscriptIdeaBlockStatus;
}

export interface LatestTranscriptIdeaBlockStatusUpdate {
	generationComplete: boolean;
	ideaBlockCount: number;
	transcriptSegmentIds: string[];
}

export interface LatestTranscriptInitialStatusInput {
	scope: string;
	persisted: boolean;
}

export function getInitialLatestTranscriptIdeaBlockStatus(input: LatestTranscriptInitialStatusInput): LatestTranscriptIdeaBlockStatus {
	return input.scope === "private" && input.persisted ? "pending" : "captured";
}

export function latestTranscriptMatchesSegmentIds(current: LatestTranscriptIdeaBlockStatusState, transcriptSegmentIds: string[]): boolean {
	if (transcriptSegmentIds.length === 0) {
		return true;
	}

	if (!current.transcriptSegmentId) {
		return false;
	}

	return transcriptSegmentIds.includes(current.transcriptSegmentId);
}

export function getLatestTranscriptIdeaBlockStatusAfterUpdate(current: LatestTranscriptIdeaBlockStatusState, update: LatestTranscriptIdeaBlockStatusUpdate): LatestTranscriptIdeaBlockStatus {
	if (!update.generationComplete) {
		return current.ideaBlockStatus;
	}

	if (!latestTranscriptMatchesSegmentIds(current, update.transcriptSegmentIds)) {
		return current.ideaBlockStatus;
	}

	return update.ideaBlockCount > 0 ? "generated" : "no_idea";
}
