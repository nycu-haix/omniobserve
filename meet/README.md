# Jitsi Meet deployment

This folder is the Dokploy-ready replacement for the current local Jitsi Compose project:

```text
/Users/skyhong/Documents/jitsi-docker-jitsi-meet-5499476
```

The current machine has Caddy listening on `80/443`, Jitsi web published on `8000/8443`, and JVB published on `10000/udp`. This deployment is adjusted for Dokploy so Traefik owns `80/443`, routes `meet.omni.elvismao.com` to the Jitsi `web` container, and keeps JVB media on `10000/udp`.

## Files

- `docker-compose.yml`: Dokploy/Traefik Compose deployment.
- `.env.example`: safe template for committed configuration.
- `.env`: local generated configuration with service passwords. This file is ignored by git.

## Migration checklist

Do not run the old Jitsi stack and this stack at the same time. Both need `10000/udp`.

1. Back up the current Caddy route before removing it:

   ```bash
   cat /usr/local/etc/caddy/Caddyfile
   ```

2. Stop the old Jitsi Compose stack:

   ```bash
   cd /Users/skyhong/Documents/jitsi-docker-jitsi-meet-5499476
   docker compose down
   ```

3. Stop Caddy after Dokploy/Traefik is ready to take `80/443`:

   ```bash
   ps aux | grep -Ei 'caddy|nginx|traefik' | grep -v grep
   brew services stop caddy
   ```

   If it was installed as a launch daemon instead of a Homebrew service, use the plist shown by `launchctl list | grep -i caddy`.

4. Confirm the host ports are free except for Dokploy/Traefik:

   ```bash
   sudo lsof -nP -iTCP -sTCP:LISTEN | grep -E ':80|:443|:8000|:8443|:8080|:8888'
   sudo lsof -nP -iUDP | grep ':10000'
   ```

5. In Dokploy, create a Docker Compose app using `meet/docker-compose.yml`.

6. Copy the values from `.env` into Dokploy's Environment panel, or upload the `.env` next to the Compose file. Dokploy saves environment values into a `.env` file, but Compose still needs explicit references or `env_file`, which this Compose file already has.

7. Deploy and verify:

   ```bash
   curl -I https://meet.omni.elvismao.com/
   curl -i https://meet.omni.elvismao.com/http-bind
   curl --http1.1 -i \
     -H 'Connection: Upgrade' \
     -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     -H 'Sec-WebSocket-Version: 13' \
     -H 'Sec-WebSocket-Protocol: xmpp' \
     https://meet.omni.elvismao.com/xmpp-websocket
   ```

8. Confirm the public runtime config exposes the expected media fallback settings:

   ```bash
   curl -s https://meet.omni.elvismao.com/config.js \
     | grep -E 'websocket|bridgeChannel|resolution'
   ```

9. For a 3-person smoke test, join a room directly through Jitsi, not through
   the OmniObserve frontend:

   ```text
   https://meet.omni.elvismao.com/jitsi-smoke-test
   ```

   In browser devtools, the failure mode this deployment is intended to prevent
   looks like:

   ```text
   ICE disconnected JVB
   JVB PC state is now failed
   Sending ICE failed - the connection did not recover
   CONFERENCE FAILED: conference.iceFailed
   ```

## Operational notes

- `JVB_ADVERTISE_IPS` is currently set to `203.145.220.54`, which is the public IP resolved by `meet.omni.elvismao.com`. Update it if the host public IP changes.
- `JVB_ADVERTISE_PRIVATE_CANDIDATES=0` is intentional for this public Docker deployment. Without it, JVB can advertise Docker-internal candidates such as `172.x.x.x:10000`, which public clients cannot use.
- `10000/udp` must remain reachable from the internet. HTTP reverse proxies do not carry this media traffic. The Jitsi Docker handbook lists `10000/udp` as the RTP media port: https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker/#architecture
- `ENABLE_COLIBRI_WEBSOCKET=1` with `JVB_PREFER_SCTP=0` keeps the JVB bridge channel on HTTPS/WebSocket instead of relying on SCTP over the media peer connection. Jitsi's FAQ recommends bridge websockets for modern deployments: https://jitsi.github.io/handbook/docs/devops-guide/faq/#how-to-migrate-away-from-multiplexing-and-enable-bridge-websockets
- `COLIBRI_WEBSOCKET_PORT=9090` is the JVB public HTTP port inside the Docker network. Do not set it to 443; TLS terminates at Traefik/web and the web container proxies `/colibri-ws/...` to JVB over plain HTTP.
- TURN is not bundled here. If participants are on networks that block or mangle UDP, configure a TURN service and set `TURN_HOST` / `TURNS_HOST` plus credentials in Dokploy. The Jitsi Docker handbook documents these external TURN variables under "TURN server configuration".
- Default video is capped to 360p (`RESOLUTION=360`, `RESOLUTION_WIDTH=640`) because the meeting pane is small and this reduces JVB bandwidth pressure for 3+ participants.
- Jitsi's generated runtime config is stored in Docker named volumes so Dokploy volume backups can include it.
- If the web page loads but participants cannot see or hear each other, check `JVB_ADVERTISE_IPS`, `JVB_ADVERTISE_PRIVATE_CANDIDATES`, firewall/NAT rules, whether `10000/udp` is still published, and whether TURN credentials are being announced instead of `service-unavailable`.
