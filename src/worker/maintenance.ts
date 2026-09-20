import { errorBody } from '../shared/messages.ts';

// Deploy this entry point before migrating an existing installation. It never
// opens D1, so it also works before the counter columns have been installed.
export default {
  fetch() {
    return Response.json(errorBody('SERVICE_UNAVAILABLE'), {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  },
} satisfies ExportedHandler;
