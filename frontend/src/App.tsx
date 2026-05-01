import "./App.css";
import { HomePage } from "./components/HomePage";
import MeetingRoom from "./components/MeetingRoom";

function App() {
	const params = new URLSearchParams(window.location.search);
	const shouldOpenMeeting = params.has("room_name") || params.has("id") || params.has("name");

	return shouldOpenMeeting ? <MeetingRoom /> : <HomePage />;
}

export default App;
