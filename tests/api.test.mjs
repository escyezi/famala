// One suite/proxy; cases register serial tests and share the isolated fixture lifecycle.
import { installApiEnvironment } from './support/api-environment.ts';
import './api/auth.cases.mjs';
import './api/pools.cases.mjs';
import './api/imports.cases.mjs';
import './api/claims.cases.mjs';
import './api/codes.cases.mjs';
import './api/exports.cases.mjs';
import './api/counters.cases.mjs';

installApiEnvironment();
