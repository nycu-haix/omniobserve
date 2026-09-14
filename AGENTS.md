# Repository Instructions

- When implementing a new feature on a personal deployment branch, commit and push to the current branch, then test that branch's deployment URL using [@Chrome](plugin://chrome@openai-bundled). The deployment URL follows the branch subdomain, for example `sky` -> `https://sky.omni.observe.tw/`, `ej` -> `https://ej.omni.observe.tw/`, `jason` -> `https://jason.omni.observe.tw/`, and `ethel` -> `https://ethel.omni.observe.tw/`.
- After pushing to a personal deployment branch, check that branch's Dokploy environment before final handoff:
  - Use the Dokploy project/environment and service deployment pages for the current branch, not another person's environment.
  - Verify the relevant service deployment is `Done` for the pushed commit hash. If both backend and frontend changed, verify both. If only frontend changed, still verify the branch deployment URL serves the new frontend asset after Dokploy finishes.
  - Use Chrome for production verification on the branch deployment URL after Dokploy is done.
  - Current IIC environments and deployment links are listed in [deploy/README.md](deploy/README.md). Each environment uses one Compose deployment for backend and frontend.
  - Production is `main` at `https://omni.observe.tw/`; `em-prompt` deploys to `https://em.omni.observe.tw/`.
