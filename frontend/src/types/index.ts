export type IdeaBlockStatus = "generating" | "ready";
export type TranscriptIdeaBlockProcessingStatus = "captured" | "pending" | "no_idea" | "failed";

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
	similarityHasSameReason?: boolean;
	similarityHasDifferentReason?: boolean;
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
	isSameReason?: boolean;
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
	ideaBlockStatus?: TranscriptIdeaBlockProcessingStatus;
}

export interface SimilarityPairCueData {
	kind?: "pair";
	id: string;
	cueId?: string;
	similarityId?: number;
	blockId: string;
	ownBlockId?: string;
	otherBlockId?: string;
	blockSummary: string;
	isSameReason?: boolean;
	hasSameReason?: boolean;
	hasDifferentReason?: boolean;
	responseStatus?: "accepted" | "ignored" | "dismissed" | "shared";
}

export interface SimilaritySummaryCueData {
	kind: "phase-transition-summary";
	id: string;
	sameReasonCount: number;
	differentReasonCount: number;
}

export type SimilarityCueData = SimilarityPairCueData | SimilaritySummaryCueData;

export interface SimilarityReasonSharedData extends SharedSimilarityReason {
	cueId?: string;
	similarityId?: number;
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
	isPending?: boolean;
	clientMessageId?: string;
}

export type MicMode = "public" | "private";
export type BoardTab = "transcript" | "ideablock" | "public-chat";
