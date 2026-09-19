import { ExportWriter } from './writer.ts';
import type { ExportCommand, ExportReply } from './types.ts';

let writer: ExportWriter | undefined;
self.onmessage = (event: MessageEvent<{ id: number; command: ExportCommand }>) => {
  const { id, command } = event.data;
  const reply: ExportReply = { id };
  try {
    if (command.type === 'init') writer = new ExportWriter(command.options);
    else {
      if (!writer) throw new Error('Export not initialized');
      switch (command.type) {
        case 'pool':
          writer.startPool(command.pool);
          break;
        case 'rows':
          writer.addRows(command.rows);
          break;
        case 'endPool':
          writer.endPool(command.endedAt);
          break;
        case 'finish':
          reply.result = writer.finish(command.endedAt);
          break;
      }
    }
  } catch {
    // Do not send library exceptions that could contain raw codes or remarks.
    reply.error = true;
    writer = undefined;
  }
  self.postMessage(reply);
};
