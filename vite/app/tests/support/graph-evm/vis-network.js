// -----------------------------------------------------------
//  [*] Test support — the vis-network double (EVM graph)
//
//  vis-network draws on a <canvas> — jsdom has none (setup.js
//  hands out an inert 2D context), so the real Network cannot
//  run here. The graph uses exactly one class of it, Network;
//  this module stands in for the whole package:
//
//    vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));
//
//  The double records what the graph hands it — the container
//  div, the node and edge DataSets (the REAL vis-data ones the
//  graph's store keeps filling, read live, so the nodes a later
//  sweep adds show up here too) and the options — answers the
//  few methods the graph calls (getScale, getViewPosition,
//  moveTo, getNodeAt, getPositions, destroy) and lets a test
//  do what a student's mouse does on the canvas:
//
//    doubleClick(id)      — the 'doubleClick' event on a node
//                           (expand the address)
//    rightClick(id)       — the 'oncontext' event with that
//                           node under the pointer (rename)
//    wheelZoom(scale)     — the 'zoom' event a wheel turn fires
//    drag(id, x)          — a node dropped at a new x
//                           ('dragEnd' with that node)
//    pan()                — a canvas pan ('dragEnd', no node)
//
//  Each of them runs inside act() and resolves after React
//  flushed what the event set off (a request it sends lands
//  later — wait for its effect on screen).
//
//  Used by:
//    - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

import { act } from '@testing-library/react';


// Every Network the graph constructed in the current test,
// oldest first — see resetNetworks
export const networks = [];

// What the next constructed Network reports from getScale();
// a test sets it (or makes it throw) before the graph boots
export const networkDefaults = { scale: 1, getScaleThrows: false };







// -----------------------------------------------------------
// Network
// -----------------------------------------------------------
//
// The stand-in for vis-network's Network. `events` holds the
// handlers the graph registered per event name; `moves`
// records every moveTo() call (the camera commands the zoom
// code sends); `destroyed` flips when the graph tears it down.
//
// Used by:
//   - useTransactionGraph.js (through the vi.mock) — one per
//     built graph
//   - the graph tests — the recorded state and the event
//     helpers
// -----------------------------------------------------------

export class Network {

  constructor(container, data, options) {
    this.container = container;
    this.data = data;
    this.options = options;
    this.events = new Map();
    this.moves = [];
    this.destroyed = false;
    this.scale = networkDefaults.scale;
    this.viewPosition = { x: 12, y: 34 };
    this.pointerNode = undefined;
    this.dropped = {};
    this.getScaleThrows = networkDefaults.getScaleThrows;
    networks.push(this);
  }


  // --- the API the graph calls ------------------------------

  on(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(handler);
  }

  off(event, handler) {
    this.events.set(event, (this.events.get(event) ?? []).filter((h) => h !== handler));
  }

  getScale() {
    if (this.getScaleThrows) throw new Error('canvas not ready');
    return this.scale;
  }

  getViewPosition() {
    return { ...this.viewPosition };
  }

  moveTo(options) {
    this.moves.push(options);
    if (typeof options?.scale === 'number') this.scale = options.scale;
    if (options?.position) this.viewPosition = { ...options.position };
  }

  getNodeAt() {
    return this.pointerNode;
  }

  // A dropped node reports where it was dropped; every other
  // node where its DataSet item says
  getPositions(ids) {
    const out = {};
    for (const id of ids) {
      const item = this.data.nodes.get(id);
      if (this.dropped[id]) out[id] = { ...this.dropped[id] };
      else if (item) out[id] = { x: item.x, y: item.y };
    }
    return out;
  }

  destroy() {
    this.destroyed = true;
    this.events.clear();
  }


  // --- what the test reads ----------------------------------

  // The drawn nodes / edges, as the DataSets hold them now
  nodes() {
    return this.data.nodes.get();
  }

  edges() {
    return this.data.edges.get();
  }

  node(id) {
    return this.data.nodes.get(id);
  }

  edge(id) {
    return this.data.edges.get(id);
  }

  // Whether the graph listens for an event at all
  listensTo(event) {
    return (this.events.get(event) ?? []).length > 0;
  }


  // --- what the test does -----------------------------------

  emit(event, params) {
    for (const handler of this.events.get(event) ?? []) handler(params);
  }

  async doubleClick(id) {
    await act(async () => {
      this.emit('doubleClick', { nodes: id ? [id] : [], edges: [], event: { type: 'dblclick' }, pointer: { DOM: { x: 100, y: 100 }, canvas: { x: 0, y: 0 } } });
    });
  }

  // The graph asks getNodeAt() which node sits under the
  // pointer — `id` undefined is a right-click on empty canvas.
  // Returns the context event, whose preventDefault the graph
  // must call (no browser menu over the canvas)
  async rightClick(id) {
    const domEvent = { type: 'contextmenu', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.pointerNode = id;
    await act(async () => {
      this.emit('oncontext', { nodes: [], edges: [], event: domEvent, pointer: { DOM: { x: 100, y: 100 }, canvas: { x: 0, y: 0 } } });
    });
    return domEvent;
  }

  // vis fires 'zoom' AFTER it moved the camera, so the double
  // takes the new scale first — the graph then pushes it back
  // when it oversteps the limits
  async wheelZoom(scale) {
    this.scale = scale;
    await act(async () => {
      this.emit('zoom', { direction: '+', scale, pointer: { x: 100, y: 100 } });
    });
  }

  async drag(id, x) {
    const item = this.data.nodes.get(id);
    this.dropped[id] = { x, y: item?.y ?? 0 };
    await act(async () => {
      this.emit('dragEnd', { nodes: [id], edges: [], event: {}, pointer: { DOM: { x, y: 0 }, canvas: { x, y: 0 } } });
    });
  }

  async pan() {
    await act(async () => {
      this.emit('dragEnd', { nodes: [], edges: [], event: {}, pointer: { DOM: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } } });
    });
  }
}







// -----------------------------------------------------------
// resetNetworks / liveNetwork
// -----------------------------------------------------------
//
// resetNetworks() empties the registry and restores the
// defaults (a beforeEach of every graph test file);
// liveNetwork() is the Network currently on screen — the
// newest one not destroyed — or undefined before the graph
// booted.
//
// Used by:
//   - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

export function resetNetworks() {
  networks.length = 0;
  networkDefaults.scale = 1;
  networkDefaults.getScaleThrows = false;
}

export function liveNetwork() {
  return [...networks].reverse().find((network) => !network.destroyed);
}
