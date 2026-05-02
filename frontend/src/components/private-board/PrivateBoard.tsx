import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import { apiUrl } from "../../services/api";
import type { BoardTab, IdeaBlock, MicMode, SimilarityCueData, TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";
import { ScrollArea } from "../ui/ScrollArea";
import { IdeaBlockItem } from "./IdeaBlockItem";
import { SimilarityCue } from "./SimilarityCue";
import { TranscriptLine } from "./TranscriptLine";

interface PrivateBoardProps {
	sessionId: string;
	participantId: string;
	micMode: MicMode;
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

type AudioTranscriptMessage =
	| {
			type: "transcript_update";
			transcript_segment_id?: string | number | null;
			mic_mode?: string | null;
			scope?: string | null;
			text?: string;
	  }
	| {
			type: "transcript";
			segment_id?: string | number | null;
			mic_mode?: string | null;
			scope?: string | null;
			text?: string;
	  };

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

const fallbackBlock = (): IdeaBlock => ({
	id: `local-${Date.now()}`,
	summary: "正在生成...",
	status: "generating"
});

function buildTranscriptUrl(sessionId: string, participantId: string): string | null {
	const userId = Number(participantId);

	if (!Number.isInteger(userId)) {
		return null;
	}

	const path = `/api/sessions/${encodeURIComponent(sessionId)}/transcripts`;
	return apiUrl(`${path}?user_id=${encodeURIComponent(String(userId))}`);
}

function transcriptResponseToLine(item: TranscriptResponse): TranscriptLineType {
	return {
		id: String(item.id),
		text: item.transcript
	};
}

function transcriptSourceFromAudioMessage(message: AudioTranscriptMessage, fallbackMicMode: MicMode): TranscriptLineType["source"] {
	const source = message.mic_mode ?? message.scope ?? fallbackMicMode;
	if (source === "public" || source === "private") {
		return source;
	}
	return undefined;
}

function audioTranscriptMessageToLine(message: AudioTranscriptMessage, fallbackMicMode: MicMode): TranscriptLineType {
	const segmentId = message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id;
	return {
		id: segmentId == null ? `audio-${Date.now()}` : `audio-${String(segmentId)}`,
		source: transcriptSourceFromAudioMessage(message, fallbackMicMode),
		text: message.text?.trim() ?? ""
	};
}

function appendTranscriptLine(lines: TranscriptLineType[], line: TranscriptLineType): TranscriptLineType[] {
	const normalizedText = line.text.trim();
	if (!normalizedText) {
		return lines;
	}

	const existingLine = lines.find(item => item.id === line.id);
	if (!existingLine) {
		const duplicateTextLine = lines.find(item => item.text.trim() === normalizedText && item.source === line.source);
		if (duplicateTextLine) {
			return lines;
		}
		return [...lines, { ...line, text: normalizedText }];
	}
	if (existingLine.text.trim() === normalizedText) {
		return lines;
	}
	return lines.map(item => (item.id === line.id ? { ...line, text: normalizedText } : item));
}

function mergeTranscriptLines(baseLines: TranscriptLineType[], nextLines: TranscriptLineType[]): TranscriptLineType[] {
	return nextLines.reduce((lines, line) => appendTranscriptLine(lines, line), baseLines);
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

export function PrivateBoard({ sessionId, participantId, micMode, lastMessage, lastAudioMessage, isConnected }: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [websocketTranscriptLines, setWebsocketTranscriptLines] = useState<TranscriptLineType[]>([]);
	const [transcriptRefreshKey, setTranscriptRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadTranscripts() {
			setTranscriptLines([]);
			try {
				const transcriptUrl = buildTranscriptUrl(sessionId, participantId);
				if (!transcriptUrl) {
					setTranscriptLines([]);
					return;
				}

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
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastMessage.type === "new_idea_block") {
				setIdeaBlocks(prev => (prev.some(block => block.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
			}

			if (lastMessage.type === "update_idea_block") {
				setIdeaBlocks(prev =>
					prev.some(block => block.id === lastMessage.payload.id)
						? prev.map(block => (block.id === lastMessage.payload.id ? { ...block, ...lastMessage.payload, status: "ready" } : block))
						: [
								...prev,
								{
									id: lastMessage.payload.id,
									summary: lastMessage.payload.summary ?? "",
									aiSummary: lastMessage.payload.aiSummary,
									transcript: lastMessage.payload.transcript,
									status: "ready"
								}
							]
				);
			}

			if (lastMessage.type === "new_transcript_line") {
				setWebsocketTranscriptLines(prev => appendTranscriptLine(prev, lastMessage.payload));
			}

			if (lastMessage.type === "similarity_cue") {
				setCues(prev => (prev.some(cue => cue.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
				setIdeaBlocks(prev => prev.map(block => (block.id === lastMessage.payload.blockId ? { ...block, hasCue: true, cueText: lastMessage.payload.blockSummary } : block)));
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastMessage]);

	useEffect(() => {
		if (!isAudioTranscriptMessage(lastAudioMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			setWebsocketTranscriptLines(prev => appendTranscriptLine(prev, audioTranscriptMessageToLine(lastAudioMessage, micMode)));
			setTranscriptRefreshKey(current => current + 1);
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage, micMode]);

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

	const toggleBlock = (id: string) => {
		setIdeaBlocks(prev => prev.map(block => (block.id === id ? { ...block, expanded: !block.expanded } : block)));
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
						<Button variant={activeTab === "websocket-transcript" ? "secondary" : "ghost"} onClick={() => setActiveTab("websocket-transcript")}>
							逐字稿 WebSocket
						</Button>
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

				<ScrollArea className="min-h-0 flex-1 p-3">
					{activeTab === "websocket-transcript" ? (
						renderTranscriptLines(websocketTranscriptLines, "尚無 WebSocket 逐字稿", jumpToBlock)
					) : activeTab === "ideablock" ? (
						<div className="grid gap-2">
							{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無想法</div>}
							{ideaBlocks.map(block => (
								<div
									key={block.id}
									ref={node => {
										blockRefs.current[block.id] = node;
									}}
								>
									<IdeaBlockItem block={block} isHighlighted={highlightedBlockId === block.id} onToggle={toggleBlock} />
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
