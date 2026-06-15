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

export function latestTranscriptMatchesSegmentIds(current: LatestTranscriptIdeaBlockStatusState, transcriptSegmentIds: string[]): boolean {
	return !(current.transcriptSegmentId && transcriptSegmentIds.length > 0 && !transcriptSegmentIds.includes(current.transcriptSegmentId));
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
