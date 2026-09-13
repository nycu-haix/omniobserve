# Single GPU host migration

Target: one AI-Trust H200.vGPU.8C64G VM for all six environments and shared services.
The previous CPU VM is a temporary migration/rollback source, not a permanent second application host.

On 2026-09-13 the new VM `omniobserve-gpu` at `10.0.0.120` reported
NVIDIA H200-35C, 35840 MiB VRAM, driver 570.172.08, 8 vCPU and 62 GiB usable RAM.
Image: Ubuntu 24.04-vgpu. No second GPU VM was created.

`compose.yml` shares CUDA device 0 between a realtime ASR worker and a dedicated
complete-file worker. Start the first worker
and finish model download before starting the second worker. Both use the existing
external model cache volume. Do not run the legacy device-1 configuration on a single vGPU.

Migration must preserve all OMNI_POSTGRES_VOLUME names, Dokploy database/configuration,
upload/queue files, ACME state and the private monitoring tunnel. Retain polling CD.
Do not copy live PostgreSQL data directories as a backup: use consistent dumps or
stop their writers and PostgreSQL before a final file copy. Keep an off-host backup
before transferring the public IP. Validate the destination through HTTPS with SNI
and certificate verification before switching traffic.

## Pricing checked 2026-09-13

[Official AI-Trust prices](https://docs.central.iic.nchc.org.tw/user-panel/price/ai-trust/)
list H200.vGPU.8C64G at NTD54.60/hour, 35 GB VRAM and a 120 GiB system disk.
NSTC/academic compute pricing is 50 percent: NTD27.30/hour or NTD19656 per
720-hour month, before separately charged storage/services. The page currently
says H200 compute fees are deferred; this is not a permanent free-service guarantee.
The standard 120 GiB system disk is listed at zero additional storage charge.
Public IPv4 charging is not yet announced on that page.

## Acceptance status

Verified before public cutover on 2026-09-13:

- Container CUDA access and both Breeze-ASR workers passed; GPU device 0 is shared.
- Six isolated database dumps restored: main/sky/ej 18 tables, ethel/jason 12,
  em 15. Volume names retained. A final source snapshot is still required at cutover.
- Destination HTTPS for production, sky and Dokploy passed with SNI and full
  certificate validation. This does not establish public-route availability.
- A 7.416-second Chinese PCM recording produced a complete streaming transcript
  through the GPU gateway and a persisted backend event. It still appended a stray
  `[` character; direct batch transcription returned only a prefix. Both need further work.
- First encrypted offsite restic snapshot completed at 2026-09-13 13:58:58 UTC.
  All seven databases from that snapshot restored in a network-isolated pgvector
  container: Dokploy 67 tables, with application table counts matching the list above.
- Public traffic remains on the old CPU host. TURN, full product acceptance,
  old-host retirement remain pending. The existing incident channel accepted a
  clearly labelled test notification; the status dashboard accepted the backup heartbeat.

## Shared local LLM

The selected local candidate is Ollama `qwen3:8b`, alongside `bge-m3` embeddings.
This is a smaller model than the previous configured cloud `qwen3.6-plus`; assess
meeting idea extraction and generated task quality before accepting it.
`llm-proxy.py` privately translates application `enable_thinking` to Ollama
`reasoning_effort`. A simple JSON response passed in 0.13 seconds with reasoning
explicitly disabled; this is not a general latency benchmark or product acceptance.
The proxy has no public route. Backend configuration uses
`OPENAI_BASE_URL=http://llm-proxy:8080/v1`, `OPENAI_MODEL=qwen3:8b`, and a nonempty
local-client placeholder key (Ollama requires no provider secret). Keep `LLM_MOCK=0`.

## Offsite backup

Install `backup.sh` as `/usr/local/sbin/omniobserve-backup`, with the supplied
systemd service/timer. Private SSH key, pinned host key and restic password live
under `/etc/omniobserve-backup` (mode 0700). Keep an independent recovery copy of
that password; the encrypted repository alone cannot recover it.
The destination is the restricted `omni-backup` account on skyhong.tw, under
`/var/lib/omni-backup/omniobserve`. The schedule is 03:20 Asia/Taipei with up to
10 minutes jitter; retention is 14 daily, 8 weekly and 6 monthly snapshots.

The job dumps all six application databases and Dokploy, snapshots SQLite with
its backup API, and includes application volumes, Dokploy/TLS settings and CD
configuration. Re-downloadable model caches are excluded. Status is written to
`/var/lib/omniobserve-backup/status.json`. A successful snapshot is distinct from
an isolated restore test and notification test.


## ASR model selection

The selected deployment model remains `MediaTek-Research/Breeze-ASR-25` for
Mandarin meetings. Breeze-ASR-26 was reviewed but not deployed: its
[official model card](https://huggingface.co/MediaTek-Research/Breeze-ASR-26)
describes Taiwanese Hokkien fine-tuning, not a general Mandarin upgrade.
`OMNI_ASR_MODEL` can override the default during a future isolated evaluation;
preserve the model cache volume when redeploying.

## TURN

`turn.compose.yml` is installed in the existing Dokploy infrastructure environment
as Compose `v3-xHel9haw8kqyO6NnAV`. The DNS-only A record `turn.omni.observe.tw`
uses the existing public IPv4. `turn-traefik.yml` routes TLS by SNI on TCP 443 to
coturn on private port 5349. Relay UDP is limited to 49160–49200 in IIC and coturn.
The TLS certificate is issued by the existing Traefik DNS-01 resolver.
`turn-certificate.py` and its hourly systemd timer export renewed certificate
material privately and restart coturn only when it changes. Include this material
and the TURN shared secret in encrypted backups.

Jitsi advertises `TURNS_HOST=turn.omni.observe.tw`, `TURNS_PORT=443` with its
private `TURN_CREDENTIALS` shared secret. The JVB advertises both the public IP and
10.0.0.120 so the local TURN server can reach it without relying on public NAT
hairpinning. Coturn permits that specific private peer and denies other private,
loopback and link-local ranges. Public two-client media and forced-relay acceptance
are still required after the floating IP cutover.

## Latest functional evidence before cutover

- Qwen3 8B ran the actual backend idea-extraction function with `LLM_MOCK=0`.
  The 48-character Mandarin survival-task sample produced two relevant idea blocks
  in 5.4 seconds. Full meeting workflow/quality acceptance remains pending.
- The dedicated GPU batch decoder returned the complete 7.416-second Mandarin
  sample. The authenticated operations upload queue completed the same job and
  downloaded exactly the saved transcript (no truncated prefix).
- Unified status refreshed at 2026-09-13 14:28 UTC: 25/25 targets, 19/19 Docker
  services, 5/5 heartbeats. These counts still reflect the pre-cutover origin path;
  they do not prove GPU public access or product acceptance.
- Local direct IIC access briefly timed out; the existing Unix-socket monitor tunnel
  retained verified TLS access. Public Chrome and HTTPS probes subsequently recovered.
