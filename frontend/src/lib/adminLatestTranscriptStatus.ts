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

export function getLatestTranscriptIdeaBlockStatusAfterUpdate(current: LatestTranscriptIdeaBlockStatusState, update: LatestTranscriptIdeaBlockStatusUpdate): LatestTranscriptIdeaBlockStatus {
	if (!update.generationComplete) {
		return current.ideaBlockStatus;
	}

	if (current.transcriptSegmentId && update.transcriptSegmentIds.length > 0 && !update.transcriptSegmentIds.includes(current.transcriptSegmentId)) {
		return current.ideaBlockStatus;
	}

	return update.ideaBlockCount > 0 ? "generated" : "no_idea";
}
