# Project guide

- Product: “我们的时光”, a private two-person life space with meals, calendar and travel photos; no commerce.
- Frontend: native WeChat Mini Program, JavaScript/WXML/WXSS in the self-contained `miniprogram/` project.
- Backend: Python 3.9+ + FastAPI + PyMySQL/MySQL in `server/`.
- APIs return `{ code, message, data }`; authenticated shared data must always be scoped by the token-derived space ID (`space_id` in SQL; legacy `coupleId` in API responses).
- Never put AppSecret, database passwords, COS secrets, template IDs, or production tokens in frontend code or Git.
- Orders store dish snapshots. Dish deletion is soft (`enabled = 0`). Calories are estimates and hidden when unset.
- Visual language: the approved integrated “我们的时光” prototype uses warm paper `#F7F5EE`, sage `#42664F`, white cards, generous space, and natural Chinese copy. Older food pages may retain cream pink `#FFF7FA` and `#FF8FAE` until updated; follow `docs/prototype-decisions.md` for the integrated pages.
- Keep dependencies and architecture small. Do not add pricing, payment, delivery, inventory, coupons, merchants, AI, or enterprise infrastructure.
- Canonical design: `docs/product-design.md` and `docs/prototype-decisions.md`; architecture and security: `docs/architecture.md`; deployment: `docs/deployment.md`.
- Production server is reachable through the existing `ssh lyc` alias as `ubuntu`; use `sudo` for privileged deployment operations. Build backend images on the server and follow the deployment guide.

- Current database is `our_time`; schema mapping and safe cutover: `docs/schema-refactor.md`. Table documentation source: `database/catalog.json`; regenerate with `python3 scripts/build_schema_docs.py`.
