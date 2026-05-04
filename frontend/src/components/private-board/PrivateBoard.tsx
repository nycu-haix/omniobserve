import { Plus } from "lucide-react";
import type { UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import { apiUrl } from "../../services/api";
import type { BoardTab, IdeaBlock, SimilarityCueData, TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";
import { ScrollArea } from "../ui/ScrollArea";
import { IdeaBlockItem } from "./IdeaBlockItem";
import { SimilarityCue } from "./SimilarityCue";
import { TranscriptLine } from "./TranscriptLine";

interface PrivateBoardProps {
	sessionId: string;
	participantId: string;
	lastMessage: object | null;
	lastAudioMessage: object | null;
	isConnected: boolean;
}

type BoardMessage =
	| { type: "new_idea_block"; payload: IdeaBlock }
	| { type: "update_idea_block"; payload: Partial<IdeaBlock> & { id: string } }
	| { type: "new_transcript_line"; payload: TranscriptLineType }
	| { type: "similarity_cue"; payload: SimilarityCueData };

interface TranscriptResponse {
	id: number;
	user_id: number;
	session_name: string;
	time_stamp: string;
	transcript: string;
}

interface IdeaBlockResponse {
	id: number;
	title: string;
	summary: string;
	transcript: string | null;
	similarity_id: string | null;
}

type AudioTranscriptMessage =
	| {
		type: "transcript_update";
		transcript_segment_id?: string | number | null;
		mic_mode?: string | null;
		scope?: string | null;
		text?: string;
		timestamp_ms?: number | null;
		local_mic_mode?: string | null;
		reason?: string | null;
		persisted?: boolean | null;
	}
	| {
		type: "transcript";
		segment_id?: string | number | null;
		mic_mode?: string | null;
		scope?: string | null;
		text?: string;
		timestamp_ms?: number | null;
		local_mic_mode?: string | null;
		reason?: string | null;
		persisted?: boolean | null;
	};

const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

function isNearScrollBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function isBoardMessage(message: object | null): message is BoardMessage {
	if (!message || !("type" in message) || !("payload" in message)) {
		return false;
	}

	return message.type === "new_idea_block" || message.type === "update_idea_block" || message.type === "new_transcript_line" || message.type === "similarity_cue";
}

function isAudioTranscriptMessage(message: object | null): message is AudioTranscriptMessage {
	return (
		!!message && "type" in message && (message.type === "transcript_update" || message.type === "transcript") && "text" in message && typeof message.text === "string" && message.text.trim().length > 0
	);
}

function isAudioIdeaBlocksUpdateMessage(message: object | null): boolean {
	return !!message && "type" in message && message.type === "idea_blocks_update";
}

const fallbackBlock = (): IdeaBlock => ({
	id: `local-${Date.now()}`,
	summary: "正在生成...",
	status: "generating"
});

function getTranscriptUserId(participantId: string): number {
	const userId = Number(participantId);
	return Number.isInteger(userId) ? userId : 0;
}

function buildTranscriptUrl(sessionId: string, participantId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/transcripts`);
}

function buildTranscriptDetailUrl(sessionId: string, participantId: string, transcriptId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/transcripts/${encodeURIComponent(transcriptId)}`);
}

function buildIdeaBlocksUrl(sessionId: string, participantId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/idea-blocks`);
}

function buildIdeaBlockDetailUrl(sessionId: string, participantId: string, ideaBlockId: string): string {
	return `${buildIdeaBlocksUrl(sessionId, participantId)}/${encodeURIComponent(ideaBlockId)}`;
}

function transcriptResponseToLine(item: TranscriptResponse): TranscriptLineType {
	return {
		id: String(item.id),
		source: "private",
		time: formatTranscriptTime(item.time_stamp),
		text: item.transcript
	};
}

function ideaBlockResponseToBlock(item: IdeaBlockResponse): IdeaBlock {
	return {
		id: String(item.id),
		summary: item.title || item.summary,
		aiSummary: item.summary,
		transcript: item.transcript ?? undefined,
		hasCue: !!item.similarity_id,
		status: "ready"
	};
}

function formatTranscriptTime(value: string | number | null | undefined): string | undefined {
	if (value == null) {
		return undefined;
	}

	const date = new Date(typeof value === "number" ? value : value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}

	return new Intl.DateTimeFormat("zh-TW", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	}).format(date);
}

function isDbTranscriptId(transcriptId: string): boolean {
	return /^\d+$/.test(transcriptId);
}

function transcriptSourceFromAudioMessage(message: AudioTranscriptMessage): TranscriptLineType["source"] {
	const source = message.local_mic_mode ?? message.mic_mode ?? message.scope;
	if (source === "public" || source === "private") {
		return source;
	}
	return undefined;
}

function audioTranscriptMessageToLine(message: AudioTranscriptMessage): TranscriptLineType {
	const segmentId = message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id;
	return {
		id: segmentId == null ? `audio-${Date.now()}` : String(segmentId),
		source: transcriptSourceFromAudioMessage(message),
		time: formatTranscriptTime(message.timestamp_ms),
		text: message.text?.trim() ?? ""
	};
}

function shouldSyncAudioTranscriptFromDb(message: AudioTranscriptMessage, line: TranscriptLineType): boolean {
	return message.type === "transcript_update" && isDbTranscriptId(line.id);
}

function shouldAppendAudioTranscriptToTranscriptTab(message: AudioTranscriptMessage): boolean {
	return message.type === "transcript_update" || (message.type === "transcript" && message.persisted !== false);
}

function audioTranscriptDisplaySignature(message: AudioTranscriptMessage, line: TranscriptLineType): string {
	return [message.type, line.source ?? "", message.reason ?? "", line.text.trim()].join("|");
}

function appendTranscriptLine(lines: TranscriptLineType[], line: TranscriptLineType): TranscriptLineType[] {
	const normalizedText = line.text.trim();
	if (!normalizedText) {
		return lines;
	}

	const existingLine = lines.find(item => item.id === line.id);
	if (!existingLine) {
		return [...lines, { ...line, text: normalizedText }];
	}
	if (existingLine.text.trim() === normalizedText && existingLine.time === line.time) {
		return lines;
	}
	return lines.map(item => (item.id === line.id ? { ...line, text: normalizedText } : item));
}

function mergeTranscriptLines(baseLines: TranscriptLineType[], nextLines: TranscriptLineType[]): TranscriptLineType[] {
	return nextLines.reduce((lines, line) => appendTranscriptLine(lines, line), baseLines);
}

function mergeIdeaBlocks(baseBlocks: IdeaBlock[], nextBlocks: IdeaBlock[]): IdeaBlock[] {
	return nextBlocks.reduce((blocks, nextBlock) => {
		const existingBlock = blocks.find(block => block.id === nextBlock.id);
		if (!existingBlock) {
			return [...blocks, nextBlock];
		}

		return blocks.map(block =>
			block.id === nextBlock.id
				? {
					...block,
					...nextBlock,
					expanded: block.expanded,
					cueText: block.cueText,
					hasCue: block.hasCue || nextBlock.hasCue
				}
				: block
		);
	}, baseBlocks);
}

function renderTranscriptLines(lines: TranscriptLineType[], emptyText: string, onJumpToBlock: (blockId: string) => void) {
	return (
		<div className="grid gap-1">
			{lines.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">{emptyText}</div>}
			{lines.map(line => (
				<TranscriptLine key={line.id} line={line} onJumpToBlock={onJumpToBlock} />
			))}
		</div>
	);
}

export function PrivateBoard({ sessionId, participantId, lastMessage, lastAudioMessage, isConnected }: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [transcriptRefreshKey, setTranscriptRefreshKey] = useState(0);
	const [ideaBlockRefreshKey, setIdeaBlockRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const scrollViewportRef = useRef<HTMLDivElement | null>(null);
	const lastProcessedAudioMessageRef = useRef<object | null>(null);
	const lastDisplayedAudioTranscriptRef = useRef<{ signature: string; displayedAt: number } | null>(null);
	const shouldAutoScrollRef = useRef<Record<BoardTab, boolean>>({
		transcript: true,
		ideablock: true
	});

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadTranscripts() {
			try {
				const transcriptUrl = buildTranscriptUrl(sessionId, participantId);
				const response = await fetch(transcriptUrl, { signal: controller.signal });
				if (!response.ok) {
					throw new Error("Failed to load transcripts");
				}

				const transcriptLinesFromDb = ((await response.json()) as TranscriptResponse[]).map(transcriptResponseToLine);
				setTranscriptLines(prev => mergeTranscriptLines(transcriptLinesFromDb, prev));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load transcripts", error);
			}
		}

		void loadTranscripts();

		return () => controller.abort();
	}, [participantId, sessionId, transcriptRefreshKey]);

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadIdeaBlocks() {
			try {
				const response = await fetch(buildIdeaBlocksUrl(sessionId, participantId), { signal: controller.signal });
				if (!response.ok) {
					throw new Error("Failed to load idea blocks");
				}

				const ideaBlocksFromDb = ((await response.json()) as IdeaBlockResponse[]).map(ideaBlockResponseToBlock);
				setIdeaBlocks(prev => mergeIdeaBlocks(prev, ideaBlocksFromDb));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load idea blocks", error);
			}
		}

		void loadIdeaBlocks();

		return () => controller.abort();
	}, [ideaBlockRefreshKey, participantId, sessionId]);

	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastMessage.type === "new_idea_block") {
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "update_idea_block") {
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "new_transcript_line") {
				setTranscriptLines(prev => appendTranscriptLine(prev, lastMessage.payload));
			}

			if (lastMessage.type === "similarity_cue") {
				setCues(prev => (prev.some(cue => cue.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
				setIdeaBlocks(prev => prev.map(block => (block.id === lastMessage.payload.blockId ? { ...block, hasCue: true, cueText: lastMessage.payload.blockSummary } : block)));
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastMessage]);

	const syncTranscriptFromDb = useCallback(
		async (line: TranscriptLineType) => {
			try {
				if (!isDbTranscriptId(line.id)) {
					return;
				}

				const existingResponse = await fetch(buildTranscriptDetailUrl(sessionId, participantId, line.id));
				if (!existingResponse.ok) {
					throw new Error("Failed to load persisted transcript");
				}

				const savedLine = transcriptResponseToLine((await existingResponse.json()) as TranscriptResponse);
				setTranscriptLines(prev => appendTranscriptLine(prev, savedLine));
				setTranscriptRefreshKey(current => current + 1);
			} catch (error) {
				console.warn("[private-board] failed to sync persisted transcript", error);
			}
		},
		[participantId, sessionId]
	);

	useEffect(() => {
		if (!isAudioTranscriptMessage(lastAudioMessage)) {
			return;
		}
		if (lastProcessedAudioMessageRef.current === lastAudioMessage) {
			return;
		}
		lastProcessedAudioMessageRef.current = lastAudioMessage;

		const timer = window.setTimeout(() => {
			const transcriptLine = audioTranscriptMessageToLine(lastAudioMessage);
			if (shouldAppendAudioTranscriptToTranscriptTab(lastAudioMessage)) {
				const signature = audioTranscriptDisplaySignature(lastAudioMessage, transcriptLine);
				const displayed = lastDisplayedAudioTranscriptRef.current;
				const now = Date.now();
				if (displayed && displayed.signature === signature && now - displayed.displayedAt < 2000) {
					return;
				}
				lastDisplayedAudioTranscriptRef.current = { signature, displayedAt: now };
				setTranscriptLines(prev => appendTranscriptLine(prev, transcriptLine));
			}
			if (shouldSyncAudioTranscriptFromDb(lastAudioMessage, transcriptLine)) {
				void syncTranscriptFromDb(transcriptLine);
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage, syncTranscriptFromDb]);

	useEffect(() => {
		if (!isAudioIdeaBlocksUpdateMessage(lastAudioMessage)) {
			return;
		}

		setIdeaBlockRefreshKey(current => current + 1);
	}, [lastAudioMessage]);

	useEffect(() => {
		if (!highlightedBlockId) {
			return;
		}

		blockRefs.current[highlightedBlockId]?.scrollIntoView({
			behavior: "smooth",
			block: "center"
		});

		const timer = window.setTimeout(() => setHighlightedBlockId(null), 1500);
		return () => window.clearTimeout(timer);
	}, [highlightedBlockId]);

	const jumpToBlock = (blockId: string) => {
		setActiveTab("ideablock");
		setHighlightedBlockId(blockId);
	};

	const handleBoardScroll = (event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current[activeTab] = isNearScrollBottom(event.currentTarget);
	};

	useLayoutEffect(() => {
		const viewport = scrollViewportRef.current;
		if (!viewport || !shouldAutoScrollRef.current[activeTab]) {
			return;
		}

		viewport.scrollTop = viewport.scrollHeight;
	}, [activeTab, ideaBlocks, transcriptLines]);

	const toggleBlock = (id: string) => {
		setIdeaBlocks(prev => prev.map(block => (block.id === id ? { ...block, expanded: !block.expanded } : block)));
	};

	const saveIdeaBlock = async (id: string, values: { summary: string; aiSummary: string; transcript: string }) => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			setIdeaBlocks(prev => prev.map(block => (block.id === id ? { ...block, summary: values.summary, aiSummary: values.aiSummary, transcript: values.transcript } : block)));
			return;
		}

		const response = await fetch(buildIdeaBlockDetailUrl(sessionId, participantId, id), {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: values.summary,
				summary: values.aiSummary,
				transcript: values.transcript
			})
		});

		if (!response.ok) {
			throw new Error("Failed to save idea block");
		}

		const savedBlock = ideaBlockResponseToBlock((await response.json()) as IdeaBlockResponse);
		setIdeaBlocks(prev =>
			prev.map(block =>
				block.id === id
					? {
						...block,
						...savedBlock,
						expanded: block.expanded,
						cueText: block.cueText,
						hasCue: block.hasCue || savedBlock.hasCue
					}
					: block
			)
		);
		setTranscriptRefreshKey(current => current + 1);
	};

	const addBlock = async () => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			const newBlock = fallbackBlock();
			setIdeaBlocks(prev => [...prev, newBlock]);
			setActiveTab("ideablock");
			setHighlightedBlockId(newBlock.id);
			return;
		}

		try {
			const response = await fetch(apiUrl("/api/board/block"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionName: sessionId })
			});

			if (!response.ok) {
				throw new Error("Failed to create block");
			}
		} catch {
			setIdeaBlocks(prev => [...prev, fallbackBlock()]);
		}
	};

	return (
		<>
			<section className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex items-center justify-between gap-3 border-b p-3">
					<div className="flex rounded-lg bg-muted p-1">
						<Button variant={activeTab === "transcript" ? "secondary" : "ghost"} onClick={() => setActiveTab("transcript")}>
							逐字稿
						</Button>
						<Button variant={activeTab === "ideablock" ? "secondary" : "ghost"} onClick={() => setActiveTab("ideablock")}>
							Idea Block
						</Button>
					</div>
					<div className="flex items-center gap-2">
						<span className={`hidden h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
						<Button aria-label="Add idea block" className="hidden" size="icon" onClick={addBlock}>
							<Plus className="h-4 w-4" />
						</Button>
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={scrollViewportRef} viewportProps={{ onScroll: handleBoardScroll }}>
					{activeTab === "ideablock" ? (
						<div className="grid gap-2">
							{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無想法</div>}
							{ideaBlocks.map(block => (
								<div
									key={block.id}
									ref={node => {
										blockRefs.current[block.id] = node;
									}}
								>
									<IdeaBlockItem block={block} isHighlighted={highlightedBlockId === block.id} onToggle={toggleBlock} onSave={saveIdeaBlock} />
								</div>
							))}
						</div>
					) : (
						renderTranscriptLines(transcriptLines, "尚無逐字稿", jumpToBlock)
					)}
				</ScrollArea>
			</section>

			<SimilarityCue cues={cues} onJump={jumpToBlock} onDismiss={cueId => setCues(prev => prev.filter(cue => cue.id !== cueId))} />
		</>
	);
}
