# Repository Instructions

- When implementing a new feature on a personal deployment branch, commit and push to the current branch, then test that branch's deployment URL using [@Chrome](plugin://chrome@openai-bundled). The deployment URL follows the branch subdomain, for example `sky` -> `https://sky.omni.elvismao.com/`, `ej` -> `https://ej.omni.elvismao.com/`, `jason` -> `https://jason.omni.elvismao.com/`, and `ethel` -> `https://ethel.omni.elvismao.com/`.
- After pushing to a personal deployment branch, check that branch's Dokploy environment before final handoff:
  - Use the Dokploy project/environment and service deployment pages for the current branch, not another person's environment.
  - Verify the relevant service deployment is `Done` for the pushed commit hash. If both backend and frontend changed, verify both. If only frontend changed, still verify the branch deployment URL serves the new frontend asset after Dokploy finishes.
  - Use Chrome for production verification on the branch deployment URL after Dokploy is done.
  - For the `sky` branch, the Dokploy links are:
    - Project/environment: `https://dokploy.omni.elvismao.com/dashboard/project/eBpy0zdwgD7qwalkeefAd/environment/DcsSA4yUGTALixthLZ0v4`
    - Backend compose deployments: `https://dokploy.omni.elvismao.com/dashboard/project/eBpy0zdwgD7qwalkeefAd/environment/DcsSA4yUGTALixthLZ0v4/services/compose/aUjeHZM855eQ9jlgG56_0?tab=deployments`
    - Frontend compose deployments: `https://dokploy.omni.elvismao.com/dashboard/project/eBpy0zdwgD7qwalkeefAd/environment/DcsSA4yUGTALixthLZ0v4/services/compose/nj1X_yllF5Z_cPbU6CJWp?tab=deployments`
