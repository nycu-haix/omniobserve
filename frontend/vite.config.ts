import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		{
			name: "local-jitsi-external-api",
			configureServer(server) {
				server.middlewares.use("/__jitsi_external_api.js", async (_req, res, next) => {
					try {
						const baseUrl = process.env.JITSI_INTERNAL_BASE_URL || process.env.VITE_JITSI_BASE_URL;
						if (!baseUrl) {
							throw new Error("JITSI_INTERNAL_BASE_URL or VITE_JITSI_BASE_URL is required");
						}

						const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/external_api.js`);
						if (!response.ok) {
							throw new Error(`Jitsi external API responded with HTTP ${response.status}`);
						}

						const source = await response.text();
						const patchedSource = source.replace("url:`https://${t}/#jitsi_meet_external_api_id=${j}`", "url:`http://${t}/#jitsi_meet_external_api_id=${j}`");

						res.setHeader("Content-Type", "application/javascript; charset=utf-8");
						res.end(patchedSource);
					} catch (error) {
						next(error);
					}
				});
			}
		}
	]
});
