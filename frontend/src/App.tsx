import "./App.css";
import { AdminPage } from "./components/AdminPage";
import { HomePage } from "./components/HomePage";
import MeetingRoom from "./components/MeetingRoom";

function App() {
	const params = new URLSearchParams(window.location.search);
	const isAdminPage = window.location.pathname === "/admin";
	const shouldOpenMeeting = params.has("room_name") || params.has("id") || params.has("name");

	if (isAdminPage) {
		return <AdminPage />;
	}

	return shouldOpenMeeting ? <MeetingRoom /> : <HomePage />;
}

export default App;
