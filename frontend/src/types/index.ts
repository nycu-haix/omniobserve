export type IdeaBlockStatus = "generating" | "ready";

export interface IdeaBlock {
	id: string;
	summary: string;
	aiSummary?: string;
	transcript?: string;
	transcriptLineId?: string;
	sourceTranscriptIds?: string[];
	hasCue?: boolean;
	cueText?: string;
	similarityIsSameReason?: boolean | null;
	publicContextRelevant?: boolean;
	publicContextScore?: number | null;
	publicContextReason?: string;
	publicContextExpiresAtMs?: number;
	sharedReasons?: SharedSimilarityReason[];
	expanded?: boolean;
	isUnread?: boolean;
	isDeleted?: boolean;
	isDraft?: boolean;
	createdAtMs?: number;
	status: IdeaBlockStatus;
}

export interface SharedSimilarityReason {
	id: string;
	title: string;
	summary: string;
	receivedAtMs?: number;
}

export interface TranscriptLine {
	id: string;
	text: string;
	time?: string;
	timestampMs?: number;
	source?: "public" | "private";
	origin?: "history" | "live";
	userId?: string;
	displayName?: string;
	isOwn?: boolean;
	isDraft?: boolean;
	linkedBlockId?: string;
}

export interface SimilarityPairCueData {
	kind?: "pair";
	id: string;
	blockId: string;
	blockSummary: string;
	isSameReason?: boolean;
}

export interface SimilaritySummaryCueData {
	kind: "phase-transition-summary";
	id: string;
	sameReasonCount: number;
	differentReasonCount: number;
}

export type SimilarityCueData = SimilarityPairCueData | SimilaritySummaryCueData;

export interface SimilarityReasonSharedData extends SharedSimilarityReason {
	blockId: string;
}

export interface PublicChatMessage {
	id: string;
	sessionName?: string;
	userId?: string;
	displayName?: string;
	message: string;
	time?: string;
	timestampMs?: number;
	isOwn?: boolean;
	isDeleted?: boolean;
}

export type MicMode = "public" | "private";
export type BoardTab = "transcript" | "ideablock" | "public-chat";
