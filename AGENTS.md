# Project guide

- Product: “两个人的小饭桌”, a private two-person meal planner, not a commerce app.
- Frontend: native WeChat Mini Program, JavaScript/WXML/WXSS in the self-contained `miniprogram/` project.
- Backend: Node.js + Express + MySQL in `server/`.
- APIs return `{ code, message, data }`; authenticated couple data must always be scoped by token-derived `couple_id`.
- Never put AppSecret, database passwords, COS secrets, template IDs, or production tokens in frontend code or Git.
- Orders store dish snapshots. Dish deletion is soft (`enabled = 0`). Calories are estimates and hidden when unset.
- Visual language: cream pink `#FFF7FA`, primary `#FF8FAE`, white cards, 20–32rpx radius, subtle shadows, natural Chinese copy.
- Keep dependencies and architecture small. Do not add pricing, payment, delivery, inventory, coupons, merchants, AI, or enterprise infrastructure.
- Canonical design: `docs/PRODUCT_DESIGN.md`; architecture and security: `docs/ARCHITECTURE.md`; deployment: `docs/DEPLOYMENT.md`.
