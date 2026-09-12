# OmniObserve operations

This is a dedicated OmniObserve interface. It does not display or administer
unrelated personal services. Production tracks main; the five development
branches are sky, ej, ethel, jason and em-prompt.

- `https://ops.omni.observe.tw`: authenticated deployment overview and recording queue.
- `https://status.omni.observe.tw`: authenticated monitoring inside IIC.
- `https://status.skyhong.tw/#omniobserve`: external monitoring on skyhong.tw,
  in a dedicated OmniObserve section of the shared dashboard. Other projects
  stay in the Products and services section. External checks may fail while local checks pass: preserve
  that signal and investigate routing/firewalls before declaring an outage global.

## Operations service

Run server.py behind HTTPS on port 8080. Persist /data and supply OPS_TARGETS
(an allowlist mapping environment name to branch, compose_id, url and console),
DOKPLOY_URL, DOKPLOY_API_KEY, AUTH_PASSWORD_SALT, AUTH_PASSWORD_HASH and
AUTH_COOKIE_SECRET via private environment settings. The password hash is
PBKDF2-HMAC-SHA256 with 200000 iterations and a UTF-8 salt. Do not commit secrets.
The team login is developers@observe.tw. Cookies are host-only and expire in 8h.

The image in Dockerfile is reproducible. The initial IIC deployment reuses the
installed `omniobserve-whisper:cpu-0.2.20` image, overrides its entrypoint with
`python /app/server.py`, and shares its model cache at /models with
HF_HOME=/models/huggingface. Source files are installed as Compose configs.
Changes to this directory must be explicitly applied to the operations Compose;
application-branch CD does not automatically update this separate service.

SQLite persists queue state and recovers interrupted processing after restart.
One CPU worker processes recordings sequentially, capped at 64 MiB and 60 minutes
per recording. Storage is capped at 1 GiB. Transient failures retry three times;
invalid audio fails immediately. Queued work can be cancelled, failed work
retried, and completed text downloaded. The shared team can see all jobs.
The operations volume needs its own backup; existing Postgres backups do not
include these files. Manual retention cleanup is currently required.

Redeploy uses only the six allowlisted Dokploy compose IDs. Version history is
Dokploy metadata, not proof of the currently served frontend asset. Rollback is
a guided new-branch/PR workflow, not an automatic reset or database rollback.
Check database compatibility and backups before merging a rollback PR.

## External monitor

`uptime.omni.observe.tw` has been retired. Its containers are stopped and its
DNS record removed; its data volume is retained. The files under `monitor/`
are retained for recovery only. If reinstating that standalone monitor, supply
private `.env` (three AUTH_* variables plus PUBLIC_ORIGIN), `config.yaml` with
OmniObserve-only endpoints and any authorized notification destination, and
`auth.py`. The proxy must be on dokploy-network. TLS is issued by the host's
existing letsencrypt resolver. Gatus data persists in the dedicated data volume.

Run tests with `python3 -m unittest discover -s deploy/operations`.
