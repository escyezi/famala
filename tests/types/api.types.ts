import { expectTypeOf } from 'vitest';
import { api, rpc } from '../../src/react-app/api.ts';
import type { ClaimRecord, UsedResult } from '../../src/shared/contracts.ts';

// Compiled by tsconfig.tests.json, never executed. Each expect-error must keep
// producing an error, so widening the client to any/unknown fails the build.
export async function apiTypeChecks() {
  const config = await api(rpc.api.config.$get());
  expectTypeOf(config.turnstileSiteKey).toEqualTypeOf<string | null>();
  const created = await api(rpc.api.spaces.$post());
  expectTypeOf(created.key).toEqualTypeOf<string>();
  expectTypeOf(created.spaceId).toEqualTypeOf<number>();
  const pool = await api(rpc.api.manage.pools.$post({ json: { name: 'New pool' } }));
  expectTypeOf(pool.id).toEqualTypeOf<number>();
  const renamed = await api(
    rpc.api.manage.pools[':id'].name.$post({
      param: { id: 'pool' },
      json: { name: 'New name' },
    }),
  );
  expectTypeOf(renamed.name).toEqualTypeOf<string>();
  expectTypeOf(renamed.id).toEqualTypeOf<number>();
  // Remark is optional; request input comes from validation, not a caller cast.
  const claimed = await api(
    rpc.api.claim.$post({ json: { claimKey: 'key', turnstileToken: 'token' } }),
  );
  expectTypeOf(claimed).toExtend<ClaimRecord>();
  const used = await api(rpc.api.claim.used.$post({ json: { claimKey: 'key', code: 'code' } }));
  expectTypeOf(used).toEqualTypeOf<UsedResult>();

  // @ts-expect-error Unknown endpoint.
  rpc.api.missing.$get();
  // @ts-expect-error Wrong HTTP method.
  rpc.api.login.$get();
  // @ts-expect-error Required JSON body.
  rpc.api.login.$post();
  // @ts-expect-error Wrong request field type.
  rpc.api.login.$post({ json: { key: 123 } });
  // @ts-expect-error Unknown request field.
  rpc.api.login.$post({ json: { key: 'key', password: 'password' } });
  // @ts-expect-error Route param is required.
  rpc.api.manage.pools[':id'].status.$post({ json: { status: 'active' } });
  // @ts-expect-error Numeric database IDs must be serialized for URL parameters.
  rpc.api.manage.pools[':id'].codes.$get({ param: { id: pool.id }, query: {} });
  // @ts-expect-error Status must be a validated enum member.
  rpc.api.manage.pools[':id'].status.$post({ param: { id: 'pool' }, json: { status: 'deleted' } });
  // @ts-expect-error Query enum must match server validation.
  rpc.api.manage.pools[':id'].codes.$get({ param: { id: 'pool' }, query: { status: 'used' } });
  // @ts-expect-error Query parameters travel as strings.
  rpc.api.manage.pools[':id'].codes.$get({ param: { id: 'pool' }, query: { page: 2 } });
  // @ts-expect-error Required verification token.
  rpc.api.claim.$post({ json: { claimKey: 'key' } });
  // @ts-expect-error Successful payload has no invented field.
  void created.nonexistent;
  // @ts-expect-error Error variants have been excluded by the response helper.
  void renamed.error;
  // @ts-expect-error API callers cannot supply arbitrary response interfaces.
  api<{ key: string }>(rpc.api.config.$get());
}
