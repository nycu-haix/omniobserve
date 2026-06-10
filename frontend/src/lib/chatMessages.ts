import type { IdeaBlock } from "../types";

export const MAX_PUBLIC_CHAT_MESSAGE_LENGTH = 2000;
export const IDEA_BLOCK_CHAT_PREFIX = "Idea block：";

const IDEA_BLOCK_CHAT_PREFIX_PATTERN = /^Idea\s*block\s*[：:]\s*/i;

export interface ParsedIdeaBlockChatMessage {
	kind: "idea-block";
	title: string;
	content: string;
}

export function parseIdeaBlockChatMessage(message: string): ParsedIdeaBlockChatMessage | null {
	const normalizedMessage = message.trim();
	const prefixMatch = normalizedMessage.match(IDEA_BLOCK_CHAT_PREFIX_PATTERN);
	if (!prefixMatch) {
		return null;
	}

	const body = normalizedMessage.slice(prefixMatch[0].length).trim();
	if (!body) {
		return null;
	}

	const [rawTitle = "", ...contentLines] = body.split(/\r?\n/);
	const title = rawTitle.trim();
	const content = contentLines.join("\n").trim() || title;
	const fallbackText = title || content;
	if (!fallbackText) {
		return null;
	}

	return {
		kind: "idea-block",
		title: title || fallbackText,
		content: content || fallbackText
	};
}

export function buildIdeaBlockChatMessage(block: Pick<IdeaBlock, "summary" | "aiSummary">): string {
	const title = block.summary.trim();
	const content = (block.aiSummary?.trim() || title).trim();
	if (!content) {
		return "";
	}

	const heading = `${IDEA_BLOCK_CHAT_PREFIX}${title || content}`;
	if (content === title || !title) {
		return heading.slice(0, MAX_PUBLIC_CHAT_MESSAGE_LENGTH).trimEnd();
	}

	const separator = "\n";
	const availableContentLength = MAX_PUBLIC_CHAT_MESSAGE_LENGTH - heading.length - separator.length;
	if (availableContentLength <= 0) {
		return heading.slice(0, MAX_PUBLIC_CHAT_MESSAGE_LENGTH).trimEnd();
	}

	const truncatedContent = content.slice(0, availableContentLength).trimEnd();
	return `${heading}${separator}${truncatedContent}`.trim();
}
