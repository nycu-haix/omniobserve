const DEFAULT_ROOM_PREFIX = "lost-at-sea";

function formatLocalDate(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${year}${month}${day}`;
}

export function getDefaultRoomName(date = new Date()) {
	const envRoomName = (import.meta.env.VITE_DEFAULT_ROOM_NAME as string | undefined)?.trim();

	if (envRoomName && envRoomName !== DEFAULT_ROOM_PREFIX) {
		return envRoomName;
	}

	return `${DEFAULT_ROOM_PREFIX}-${formatLocalDate(date)}`;
}
