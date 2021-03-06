/** @flow */

import Agent from 'src/backend/agent';
import Bridge from 'src/bridge';
import { initBackend } from 'src/backend';

const bridge = new Bridge({
  listen(fn) {
    window.addEventListener('message', event => {
      fn(event.data);
    });
  },
  send(event: string, payload: any, transferable?: Array<any>) {
    window.parent.postMessage({ event, payload }, '*', transferable);
  },
});

const agent = new Agent();
agent.addBridge(bridge);

initBackend(window.__REACT_DEVTOOLS_GLOBAL_HOOK__, agent, window.parent);
