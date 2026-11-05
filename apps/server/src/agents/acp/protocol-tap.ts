import type * as acp from '@agentclientprotocol/sdk';
import type { ProtocolObserver } from '../../providers/provider.ts';

function observeSafely(observer: ProtocolObserver, run: (target: ProtocolObserver) => void) {
  try {
    run(observer);
  } catch (error) {
    console.error('Audit observer failed', error);
  }
}

export function tapStream(stream: acp.Stream, observer: ProtocolObserver): acp.Stream {
  const readable = stream.readable.pipeThrough(
    new TransformStream<acp.AnyMessage, acp.AnyMessage>({
      transform(message, controller) {
        observeSafely(observer, (target) => target.message('from_agent', message));
        controller.enqueue(message);
      },
    }),
  );
  const writer = stream.writable.getWriter();
  const writable = new WritableStream<acp.AnyMessage>({
    write(message) {
      observeSafely(observer, (target) => target.message('to_agent', message));
      return writer.write(message);
    },
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  });
  return { readable, writable };
}
