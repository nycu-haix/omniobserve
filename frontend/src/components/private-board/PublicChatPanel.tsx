import { Send } from "lucide-react";
import { forwardRef, useLayoutEffect, useRef } from "react";
import { formatParticipantDisplayName } from "../../lib/participantDefaults";
import { cn } from "../../lib/utils";
import type { PublicChatMessage } from "../../types";
import { Button } from "../ui/Button";

interface PublicChatPanelProps {
	messages: PublicChatMessage[];
	messageText: string;
	error: string | null;
	isConnected: boolean;
	isSending: boolean;
	onMessageTextChange: (value: string) => void;
	onSend: () => void;
}

type PublicChatComposerProps = Omit<PublicChatPanelProps, "messages">;

export function PublicChatMessages({ messages }: { messages: PublicChatMessage[] }) {
	return (
		<div className="grid gap-2 pb-3">
			{messages.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無公開訊息</div>}
			{messages.map(message => (
				<div key={message.id} className={cn("flex", message.isOwn ? "justify-end" : "justify-start")}>
					<div className={cn("grid max-w-[86%] gap-1 rounded-lg border px-3 py-2 text-sm", message.isOwn ? "bg-primary text-primary-foreground" : "bg-background")}>
						<div className={cn("flex items-center gap-2 text-xs", message.isOwn ? "text-primary-foreground/75" : "text-muted-foreground")}>
							<span className="min-w-0 truncate">{formatParticipantDisplayName(message.userId, message.displayName) || "你"}</span>
							{message.time && <span className="shrink-0">{message.time}</span>}
						</div>
						<div className="whitespace-pre-wrap break-words leading-5">{message.message}</div>
					</div>
				</div>
			))}
		</div>
	);
}

export const PublicChatComposer = forwardRef<HTMLTextAreaElement, PublicChatComposerProps>(function PublicChatComposer(
	{ messageText, error, isConnected, isSending, onMessageTextChange, onSend },
	ref
) {
	const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const setTextareaRef = (node: HTMLTextAreaElement | null) => {
		localTextareaRef.current = node;
		if (typeof ref === "function") {
			ref(node);
			return;
		}
		if (ref) {
			ref.current = node;
		}
	};

	useLayoutEffect(() => {
		const textarea = localTextareaRef.current;
		if (!textarea) {
			return;
		}

		textarea.style.height = "44px";
		textarea.style.height = `${Math.max(44, textarea.scrollHeight)}px`;
	}, [messageText]);

	return (
		<div className="grid gap-2">
			<div className="flex items-end gap-2">
				<div className="relative flex-1">
					<textarea
						ref={setTextareaRef}
						aria-label="Public chat input"
						className="block min-h-11 w-full resize-none overflow-hidden rounded-md border bg-background px-3 py-2.5 pr-24 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
						placeholder="傳送公開訊息"
						value={messageText}
						maxLength={2000}
						onChange={event => onMessageTextChange(event.target.value)}
						onKeyDown={event => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								if (!messageText.trim()) {
									event.currentTarget.blur();
									return;
								}
								onSend();
								window.requestAnimationFrame(() => localTextareaRef.current?.focus());
							}
						}}
						disabled={!isConnected}
					/>
					{!messageText.trim() && <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted-foreground">shift + enter 換行</span>}
				</div>
				<Button className="h-11 w-11 shrink-0 p-0" onClick={onSend} disabled={!messageText.trim() || !isConnected} title={isSending ? "傳送中" : "傳送公開訊息"}>
					<Send className="h-4 w-4" />
				</Button>
			</div>
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
});
