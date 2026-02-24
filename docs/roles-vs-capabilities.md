## Roles vs Capabilities (compact)

| Role | Admin Panel | Invite Users | Assign Admin/Agent | Create Policies | Policies – read scope | Clients – read scope | Admin “Users” visibility | Policy Settings pages | Client/Numbering settings |
|---|---|---|---|---|---|---|---|---|---|
| Admin | Yes | Admin, Agent, Accounting, Internal Staff | Yes | Yes | All | All | All users | Yes | Yes |
| Internal Staff | Yes | Accounting, Internal Staff | No | Yes | All | All | All users | No (Admin only) | Yes |
| Agent | Yes (limited) | Accounting, Internal Staff | No | Yes | Only those created by me | Only those created by me | Only self | No (Admin only) | Yes (API/UI allowed) |
| Accounting | No | — | No | No | Membership‑scoped | All (current API) | No | No | No |
| Clients (legacy: direct_client, service_provider) | — | — | — | No | Membership‑scoped | Membership‑scoped | — | No | No |

Notes

- Membership‑scoped: data is limited to organisations where the user has an explicit membership.
- “Clients (legacy)” exist in the database but are not managed via Admin Users; invites for these types are rejected.
- Agent visibility in Admin Users is restricted to their own row; Admin and Internal Staff see all.
- Policy Settings pages (Declarations, Packages, Flows, etc.) are Admin‑only. Client/Numbering settings (prefixes) are available to Admin, Agent, and Internal Staff.

References

- Role enum: `db/schema/core.ts` (`userTypeEnum`)
- Session user type: `lib/auth/require-user.ts`
- RBAC helpers: `lib/auth/rbac.ts`
- Admin Users access and invite logic: `app/(dashboard)/admin/users/page.tsx`, `app/api/admin/users/*.ts`
- Client settings (prefixes): `app/api/admin/client-settings/route.ts`, `app/(dashboard)/admin/client-settings/page.tsx`
- Policy listing scope: `app/api/policies/route.ts`
- Clients listing scope: `app/api/clients/route.ts`

