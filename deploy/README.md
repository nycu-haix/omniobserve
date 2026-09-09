# IIC CPU deployment

The host CD service checks configured Git branches every 30 seconds and asks
Dokploy to clone the changed branch and build deploy/compose.cpu.yml. GitHub
webhook delivery cannot reach the IIC host, so delivery does not depend on inbound
webhooks. Use main for production; sky, ej, ethel, jason, and em-prompt
for their matching development environments (em-prompt uses the em hostname).

Set OMNI_POSTGRES_VOLUME to the existing environment-specific database volume.
The volume and omniobserve-embeddings network must already exist. Database
credentials and LLM settings stay in Dokploy environment settings. Do not commit
secrets or change volume names when redeploying existing data.

Frontend public URLs are VITE_API_BASE_URL, VITE_WS_BASE_URL,
VITE_AUDIO_WS_BASE_URL and VITE_JITSI_BASE_URL in Dokploy. They are build arguments;
redeploy after changing them. Without build arguments, the normal frontend
Dockerfile continues to use its existing Vite configuration.

The shared CPU embedding service is managed separately in infrastructure.
GPU ASR and Jitsi are not part of this CPU Compose file.

## Environments

| Branch | Site | Dokploy |
| --- | --- | --- |
| sky | https://sky.omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/qA8mx7xjiAv3Ti1Qc8SFb/services/compose/5IHPHhil26L4hiXNrCAaw?tab=deployments) |
| main | https://omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/waDEpmtDbwTvSUTYGZSHY/services/compose/XEaczm-V5IwvpnEPa1VZ1?tab=deployments) |
| ej | https://ej.omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/fh12whx2Ap4VWOJc-kx7E/services/compose/DBVEbmg3tC4HIKBO2_iVh?tab=deployments) |
| ethel | https://ethel.omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/Yt5l_znYlq4QQoxOHI5DB/services/compose/vQd0bkC8v25N2j2wVi3QE?tab=deployments) |
| jason | https://jason.omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/3a5DwBCjH3KxBGprjlmqH/services/compose/Q-sYCuFfUZB-FO0cIITvB?tab=deployments) |
| em-prompt | https://em.omni.observe.tw | [Deployments](https://dokploy.observe.tw/dashboard/project/4XAzxpFxB6VEErRHqWDr0/environment/6LXUM3fGRhsRUO0Mw8Mvm/services/compose/W7GffAxu3Gz8Aw08tA_LC?tab=deployments) |

## CD service

The installed systemd service is omniobserve-cd.service. It runs cd-poller.py
with a private config at /home/ubuntu/omniobserve-cd/config.json. The project-scoped
API key and state file are not committed. Inspect progress using
`journalctl -u omniobserve-cd.service`; pause automatic deploys for one environment
with its Dokploy Autodeploy switch. Failed commits retry at most three times with
a five-minute delay. Successful deployment requires frontend/API HTTPS checks.

Run `python3 deploy/test_cd_poller.py` for polling and retry behavior tests.
The host-installed poller is upgraded explicitly; application pushes do not
replace the systemd service or private configuration.

## Shared meeting and speech services

`meet/docker-compose.yml` runs one Jitsi stack for all six environments at
https://meet.omni.observe.tw. Set JVB_ADVERTISE_IPS to the VM public IP and permit
UDP10000 in its IIC security group. Traefik terminates HTTPS and proxies XMPP and
Colibri WebSockets. Service passwords remain in Dokploy. On the 8GiB bootstrap
host set VIDEOBRIDGE_MAX_MEMORY=768m and JICOFO_MAX_MEMORY=384m. P2P is disabled so
media traverses the tested JVB route. Two synthetic participants verified audio
reception and decoded video through140.110.146.224:10000.

`deploy/compose.asr.cpu.yml` provides a shared Whisper small CPU fallback plus
the existing audio gateway. It does real transcription, with mock mode disabled.
The model cache is a persistent volume. The gateway serves ai.omni.observe.tw and
all five NAME.ai.omni.observe.tw aliases; each frontend supplies its own pipeline
WebSocket URL so transcripts go to that branch's backend/database. CPU inference
has lower throughput than Breeze ASR on GPU; it is a bootstrap service, not a
claim of equivalent accuracy or multi-speaker real-time capacity.

Shared infrastructure targets in the pull-CD configuration use unique `id`
values even when they follow the same main branch. Their `health_checks` list
contains hostname/path pairs, allowing Jitsi and ASR checks without assuming a
frontend/backend pair. Existing targets without `id` remain keyed by branch.

GPU allocation and the LLM provider key are separate prerequisites. Configure
OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL in each app's Dokploy environment
and redeploy that app. Do not put credentials into Git.
