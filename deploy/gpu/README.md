# Single GPU host migration

Target: one AI-Trust H200.vGPU.8C64G VM for all six environments and shared services.
The previous CPU VM is a temporary migration/rollback source, not a permanent second application host.

On 2026-09-13 the new VM `omniobserve-gpu` at `10.0.0.120` reported
NVIDIA H200-35C, 35840 MiB VRAM, driver 570.172.08, 8 vCPU and 62 GiB usable RAM.
Image: Ubuntu 24.04-vgpu. No second GPU VM was created.

`compose.yml` shares CUDA device 0 between two ASR workers. Start the first worker
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

VM and host GPU detection passed. Container CUDA, real ASR, all environment
cutover, restored backups, TURN, notifications and final retirement remain pending.
Update this section with measured evidence before calling the migration complete.
