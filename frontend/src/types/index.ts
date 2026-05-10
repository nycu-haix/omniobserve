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
	expanded?: boolean;
	isDeleted?: boolean;
	isDraft?: boolean;
	createdAtMs?: number;
	status: IdeaBlockStatus;
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
	linkedBlockId?: string;
}

export interface SimilarityCueData {
	id: string;
	blockId: string;
	blockSummary: string;
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

export type MicMode = "public" | "private" | "off";
export type BoardTab = "transcript" | "ideablock" | "public-chat";
