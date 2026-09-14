## Context

A sub-connection opened from `sendInvitation` (#687) must be correlated by the backend with (a) the invitation that produced it and (b) the connection on which that invitation was sent. v1 exposes only `invitationId` (= `outOfBandId`) in the `connection-state-updated` event, and keeps `parentConnectionId` as a record tag that the API never returns. The spec now makes both part of the v2 connection record.

## Spec changes to implement

`listConnections` / `getConnection` record — minimum fields now include:

- `outOfBandId` — already a filter in v1; make it a returned field.
- `parentConnectionId` — id of the connection on which the agent sent the invitation that produced this connection; `null` for every other connection.

`listConnections` — new OPTIONAL query filter `parentConnectionId`.

`deleteConnection` — deleting a parent does **not** touch its sub-connections; each keeps its `parentConnectionId` (dangling is fine).

`didcomm.connections.state-updated` — `data` is the record as `getConnection` returns it, so it carries both fields automatically once the DTO does.

## Checklist

- [ ] Connection record DTO for v2 (`apps/vs-agent/src/controllers/admin/v2/didcomm/…` or shared `connections/dto/connection.dto.ts`): add `parentConnectionId: string | null`; ensure `outOfBandId` is emitted (`null` when absent, per the v2 convention of explicit nulls).
- [ ] Mapping: read `record.getTag('parentConnectionId')` (set today in `packages/agent-sdk/src/events/ConnectionEvents.ts` from the OOB record tag). Make the copy happen at record creation (`DidCommConnectionStateChanged` first emission) so the first `state-updated` event already carries it — verify the current handler ordering guarantees this; if the event can fire before the tag is set, move the tagging into the OOB → connection creation path.
- [ ] `listConnections` filter `parentConnectionId` — Credo `findAllByQuery({ parentConnectionId })` works on tags; confirm the keyset cursor of `apps/vs-agent/src/common/pagination.ts` remains stable with the extra filter (cursor replay across a different filter set must fail with `INVALID_CURSOR`).
- [ ] `deleteConnection`: no cascade. Add a test that deletes a parent and lists its children by `parentConnectionId`.
- [ ] Events: assert `parentConnectionId` and `outOfBandId` are present in `didcomm.connections.state-updated` payloads (both `null` for a connection opened from a QR invitation or by a peer).
- [ ] Unit tests in `apps/vs-agent/tests/v2DidcommConnectionRoutes.test.ts` (create if the connections module tests do not exist yet).
- [ ] Swagger: field descriptions and the new query parameter.

## Dependencies

- Spec: verana-labs/verana-spec#85.
- V2 Connections module (`listConnections`, `getConnection`, `deleteConnection`) — `V2DidcommController` is a stub today. If this issue lands together with the module, fold the field in from the start.
- #687 (Invitations module) is the only producer of non-null `parentConnectionId`; the field and filter can ship before it.