export type IdeaBlockStatus = "generating" | "ready";

export interface IdeaBlock {
	id: string;
	summary: string;
	aiSummary?: string;
	transcript?: string;
	transcriptLineId?: string;
	hasCue?: boolean;
	cueText?: string;
	expanded?: boolean;
	status: IdeaBlockStatus;
}

export interface TranscriptLine {
	id: string;
	text: string;
	time?: string;
	source?: "public" | "private";
	linkedBlockId?: string;
}

export interface SimilarityCueData {
	id: string;
	blockId: string;
	blockSummary: string;
}

export type MicMode = "public" | "private" | "off";
export type BoardTab = "transcript" | "ideablock";
