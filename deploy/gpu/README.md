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

## Acceptance status (2026-09-13, after public cutover)

The reserved public IP **140.110.146.224** was transferred to `omniobserve-gpu`
(10.0.0.120). All six frontends/APIs, PostgreSQL, Dokploy, Jitsi, TURN and AI now
run there. The previous CPU host at 10.0.0.60 is stopped (IIC confirmed at 15:46 UTC) and
retains rollback data; its application
writers, polling CD and monitor tunnel are stopped. Do not restart old writers
against stale databases or attach the public IP there without synchronizing new data.

Verified:

- Container CUDA; two Breeze-ASR-25 workers, local Qwen3 8B and bge-m3 share device 0.
- Final migration froze source writers, dumped/restored six databases, and compared
  every table's row count: main 50 rows/18 tables, sky 5/18, ej 360/18, ethel 1/12,
  jason 1/12, em 1/15. Existing volume names were retained. Counts are the migration
  baseline, not current totals after acceptance writes.
- All six branch Compose deployments were Done for their own Git commits. Chrome
  rendered each branch's own task templates; API, WS, audio and Jitsi build arguments
  were checked. Production acceptance data was absent from the other five databases.
- Chrome production workflow: create/join room `gpu-acceptance-20260913`, two
  participants, admin WebSockets, public/reflect phase transitions, shared ranking
  reorder, manual idea creation, AI idea sharing and public chat. Reload retained
  the idea blocks and transcripts; both participants observed ranking changes.
- Public WSS accepted a real 11.885-second synthetic Mandarin audio stream.
  Breeze-ASR-25 saved transcript 4; Qwen3 8B automatically generated two relevant
  idea blocks (water priority and signalling mirror), linked to task items 3 and 2.
  Chrome displayed these saved AI results after reload. No mock inference was used.
- Public authenticated audio upload completed with the full transcript and matching
  downloaded text. Earlier isolated queue restart also preserved its completed job.
- Two independent Chrome clients exchanged synthetic audio/video through JVB at
  public UDP 10000. Both received audio RTP and decoded video (67/70 frames at sample).
- Forced `iceTransportPolicy=relay` passed for both clients over TURN TLS 443:
  SDP contained only relay candidates at 140.110.146.224:49192/49187; selected
  connections reported `relayProtocol=tls`, with 27773/25712 audio bytes and
  68/61 decoded frames at sample. Chrome labelled the nominated local pair `prflx`
  after peer-reflexive discovery; SDP and forced policy confirm TURN allocation.
- Encrypted offsite snapshot `5da48bba` restored all seven databases in an isolated
  container: Dokploy 67 tables plus all six application databases. Snapshot
  `29b64e66` completed after cutover at 15:39 UTC. The later `67ff3178` snapshot
  completed at 15:47 UTC; an isolated restore of its upload/SQLite queue matched
  the original audio SHA256 and completed transcript. Backup success heartbeat and an
  explicitly marked failure-notification test both delivered to existing channels.
- Existing Unix-socket monitoring tunnel now originates on the GPU host. A verified
  TLS request through it executed on hostname `omniobserve-gpu`. No public proxy or
  replacement status site was introduced. Status reported 25/25 endpoints and all
  five heartbeats healthy after cutover. Other projects can change Docker totals.

Limitations / not established by these tests:

- The generic streaming ASR sample appended a stray `[`; the survival sample missed
  one character in `避免`. Batch decoding produced the complete expected text.
  Recognition quality is not perfect and has not been benchmarked on real meetings.
- Chrome currently reports microphone permission denied for the production page.
  Synthetic media/PCM verified transport and inference without capturing the user.
  Physical microphone/camera capture needs the site permission and a device test;
  this is separate from successful ASR and Jitsi/TURN transport.
- Two-client tests establish basic operation, not six simultaneous busy environments,
  prolonged load, every task template or long-recording quality.
- skyhong.tw still cannot directly reach the IIC public HTTPS path (10-second
  timeout), while this Mac's public HTTPS/Chrome path and the private tunnel work.
  Keep this failure visible; origin checks cannot prove all Internet routes work.

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
loopback and link-local ranges. Public two-client media and forced-relay acceptance passed after cutover.
Keep the certificate-only HTTP router on `omni-turn-certificate.invalid`, with
`tls.domains.main=turn.omni.observe.tw`. An HTTP router on the TURN hostname
intercepted TLS and left STUN allocation hanging; separating it fixed the failure.
The TCP passthrough router alone handles the real TURN hostname.


## Hosts, domains and preserved data

| Service | Branch | Public hostname | Database volume |
| --- | --- | --- | --- |
| Production | main | omni.observe.tw / api.omni.observe.tw | omniobserve-main-verfsy_postgres_data |
| Sky | sky | sky.omni.observe.tw / sky.api.omni.observe.tw | omniobserve-bootstrap_postgres_data |
| EJ | ej | ej.omni.observe.tw / ej.api.omni.observe.tw | omniobserve-ej-uqrtcz_postgres_data |
| Ethel | ethel | ethel.omni.observe.tw / ethel.api.omni.observe.tw | omniobserve-ethel-wnzans_postgres_data |
| Jason | jason | jason.omni.observe.tw / jason.api.omni.observe.tw | omniobserve-jason-ngozpx_postgres_data |
| EM | em | em.omni.observe.tw / em.api.omni.observe.tw | omniobserve-em-al3hyb_postgres_data |

All rows run on `omniobserve-gpu`, AI-Trust, UUID
`5b5a8e23-c302-4940-a742-cccb58328451`. Shared services use
`ai.omni.observe.tw` (and branch-prefixed audio aliases, `/asr`),
`meet.omni.observe.tw`, `jitsi.omni.observe.tw`, `turn.omni.observe.tw`,
`ops.omni.observe.tw`, and `dokploy.observe.tw`. Monitoring stays at
`status.skyhong.tw` on the independent skyhong.tw host. Existing Dokploy team
accounts were retained; Chrome verified developers@observe.tw can access sky.

The old CPU VM is `omniobserve-bootstrap`, UUID
`c4bdcf6f-1258-42d1-8e2c-2bb7e8b7a8de`, private 10.0.0.60. It is a rollback copy,
not a live application dependency. Do not delete its volumes during acceptance.
While it remains running, Basic.small adds an estimated NTD1.44/hour academic
compute cost (NTD1036.8/720 hours), separate from the GPU estimate above.

## Deploy and roll back

1. Commit/push the current personal branch. Production changes use a focused PR
   into main; never merge all personal development changes as a deployment shortcut.
2. `omniobserve-cd.service` polls Git every 30 seconds, serializes builds, retries
   failures after five minutes, and stops after three attempts for the same SHA.
   A new SHA resets that failure budget. Its private config/state stay under
   `/home/ubuntu/omniobserve-cd`; the key must authorize the configured Compose IDs.
3. Check the corresponding [Dokploy deployment link](../README.md), exact commit
   and Done status, then Chrome and real API/WS functions. VITE values are build
   arguments: rebuilding is required after changing them.
4. The installed poller additionally supports independent `id` values for multiple
   services following main (Jitsi and ASR), and explicit `health_checks` for services
   without frontend/backend pairs. Repo and installed poller SHA256 matched during
   cutover. To upgrade it, install the reviewed `deploy/cd-poller.py` separately to
   `/home/ubuntu/omniobserve-cd/cd-poller.py`, preserve owner/mode/private config,
   and restart its systemd service. An application push does not install the poller.
5. For an application rollback, revert the offending commit through that branch's
   normal review flow and let CD deploy the revert. For urgent pinned deployment,
   first pause that target's Autodeploy so the poller cannot undo the rollback.
   Schema rollback may require a pre-change database snapshot; do not blindly
   downgrade migrations against current data.
6. Whole-host rollback: stop GPU writers and CD, take fresh consistent dumps and
   upload/queue snapshots, restore them to the old host's **same named volumes**,
   verify table counts and HTTPS privately, then move the **reserved** floating IP
   back. Stop the GPU monitor tunnel before starting the old copy. Keep only one
   writer set and one tunnel active. Never point traffic to the stale cutover copy.

Tunnel Compose ID stays `7B7WV1k8Z5_5PRhTLL-2c`; project
`omni-monitor-tunnel-lkblfa`. The skyhong.tw socket remains
`/var/lib/omni-monitor-tunnel/socket/origin.sock`. Probes preserve original hostname,
SNI and certificate verification. The retired temporary probes remain disabled.

## Restore procedure

Run as root on a trusted isolated recovery host. Install restic, Docker and the
pgvector PostgreSQL 16 image used by the app. Retrieve the recovery SSH key,
pinned known_hosts and restic password through the private operations channel;
never put those values into Git, a prompt or a command argument.

```bash
export RESTIC_PASSWORD_FILE=/etc/omniobserve-backup/password
export RESTIC_REPOSITORY=sftp:omni-backup@217.142.232.200:/var/lib/omni-backup/omniobserve
restic_transport='ssh -i /etc/omniobserve-backup/id_ed25519 -o UserKnownHostsFile=/etc/omniobserve-backup/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes omni-backup@217.142.232.200 -s sftp'
restic -o "sftp.command=$restic_transport" snapshots --tag omniobserve
restic -o "sftp.command=$restic_transport" check
restic -o "sftp.command=$restic_transport" restore latest --target /srv/omni-restore
```

Application dumps are below restored `var/lib/omniobserve-backup/staging/databases`;
durable uploads/config volumes are in sibling `volumes`. Restore dumps into a
fresh PostgreSQL container with `--network none` and no public ports, using
`pg_restore --exit-on-error --no-owner --no-privileges`. Validate tables/rows,
representative transcript/idea relationships and an upload's downloaded text.
For actual recovery, stop the destination writers, restore into existing correctly
named volumes, then restore uploads/SQLite, Dokploy settings, TLS state and CD
configuration before starting services. Never run a test restore over production.

Reproduce media verification with `acceptance-media.html` served on localhost.
Open two tabs with the same `room` query and different `peer=1` / `peer=2`; add
`relay=1` to both to require TURN. Press Start in each and inspect inbound RTP,
frames and relay candidates; press Stop when finished. It creates canvas video
and tone audio, uses real Jitsi/TURN, and never accesses a physical microphone.

The first isolated test's evidence is `/srv/omni-migration/restore-evidence.json`;
final migration comparisons are under `/srv/omni-migration/final/`. These contain
operational evidence, not credentials. Backup status is
`/var/lib/omniobserve-backup/status.json`; inspect the systemd journal and existing
status heartbeat if the timer fails. Missing success heartbeat raises an overdue
alert after one day plus four hours; direct failures use the existing incident
webhook. Test notifications are clearly labelled.
