import { useEffect } from "react";
import "./App.css";
import { AdminPage } from "./components/AdminPage";
import { HomePage } from "./components/HomePage";
import MeetingRoom from "./components/MeetingRoom";
import { getDefaultRoomName } from "./lib/defaultRoomName";

function getRoomNameFromParams(params: URLSearchParams) {
	return (
		params
			.get("room_name")
			?.trim()
			.replace(/^["']|["']$/g, "") || getDefaultRoomName()
	);
}

function App() {
	const params = new URLSearchParams(window.location.search);
	const isAdminPage = window.location.pathname === "/admin";
	const shouldOpenMeeting = params.has("room_name") || params.has("id") || params.has("name");
	const roomName = getRoomNameFromParams(params);

	useEffect(() => {
		if (isAdminPage) {
			document.title = `OmniObserve Admin - ${roomName}`;
			return;
		}

		document.title = shouldOpenMeeting ? `OmniObserve Meeting - ${roomName}` : "OmniObserve";
	}, [isAdminPage, roomName, shouldOpenMeeting]);

	if (isAdminPage) {
		return <AdminPage />;
	}

	return shouldOpenMeeting ? <MeetingRoom /> : <HomePage />;
}

export default App;
