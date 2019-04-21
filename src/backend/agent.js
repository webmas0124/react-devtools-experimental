// @flow

import EventEmitter from 'events';
import memoize from 'memoize-one';
import throttle from 'lodash.throttle';
import { LOCAL_STORAGE_RELOAD_AND_PROFILE_KEY, LOCAL_STORAGE_LAST_KEYPATH_KEY, __DEBUG__ } from '../constants';
import { hideOverlay, showOverlay } from './views/Highlighter';

import type { RendererID, RendererInterface } from './types';
import type { Bridge } from '../types';

const debug = (methodName, ...args) => {
  if (__DEBUG__) {
    console.log(
      `%cAgent %c${methodName}`,
      'color: purple; font-weight: bold;',
      'font-weight: bold;',
      ...args
    );
  }
};

type InspectSelectParams = {|
  id: number,
  rendererID: number,
|};

type OverrideHookParams = {|
  id: number,
  hookID: number,
  path: Array<string | number>,
  rendererID: number,
  value: any,
|};

type SetInParams = {|
  id: number,
  path: Array<string | number>,
  rendererID: number,
  value: any,
|};

type OverrideSuspenseParams = {|
  id: number,
  rendererID: number,
  forceFallback: boolean,
|};

export default class Agent extends EventEmitter {
  _bridge: Bridge = ((null: any): Bridge);
  _isProfiling: boolean = false;
  _rendererInterfaces: { [key: RendererID]: RendererInterface } = {};

  constructor() {
    super();

    if (localStorage.getItem(LOCAL_STORAGE_RELOAD_AND_PROFILE_KEY) === 'true') {
      this._isProfiling = true;

      localStorage.removeItem(LOCAL_STORAGE_RELOAD_AND_PROFILE_KEY);
    }

    if (this._getSavedKeyPath() !== null) {
      this._keyPathToRestore = this._getSavedKeyPath();
    }
  }

  addBridge(bridge: Bridge) {
    this._bridge = bridge;

    bridge.addListener('captureScreenshot', this.captureScreenshot);
    bridge.addListener(
      'clearHighlightedElementInDOM',
      this.clearHighlightedElementInDOM
    );
    bridge.addListener('exportProfilingSummary', this.exportProfilingSummary);
    bridge.addListener('getCommitDetails', this.getCommitDetails);
    bridge.addListener('getFiberCommits', this.getFiberCommits);
    bridge.addListener('getInteractions', this.getInteractions);
    bridge.addListener('getProfilingStatus', this.getProfilingStatus);
    bridge.addListener('getProfilingSummary', this.getProfilingSummary);
    bridge.addListener('highlightElementInDOM', this.highlightElementInDOM);
    bridge.addListener('inspectElement', this.inspectElement);
    bridge.addListener('logElementToConsole', this.logElementToConsole);
    bridge.addListener('overrideContext', this.overrideContext);
    bridge.addListener('overrideHookState', this.overrideHookState);
    bridge.addListener('overrideProps', this.overrideProps);
    bridge.addListener('overrideState', this.overrideState);
    bridge.addListener('overrideSuspense', this.overrideSuspense);
    bridge.addListener('reloadAndProfile', this.reloadAndProfile);
    bridge.addListener('screenshotCaptured', this.screenshotCaptured);
    bridge.addListener('selectElement', this.selectElement);
    bridge.addListener('startInspectingDOM', this.startInspectingDOM);
    bridge.addListener('startProfiling', this.startProfiling);
    bridge.addListener('stopInspectingDOM', this.stopInspectingDOM);
    bridge.addListener('stopProfiling', this.stopProfiling);
    bridge.addListener(
      'syncSelectionFromNativeElementsPanel',
      this.syncSelectionFromNativeElementsPanel
    );
    bridge.addListener('shutdown', this.shutdown);
    bridge.addListener('viewElementSource', this.viewElementSource);

    if (this._isProfiling) {
      this._bridge.send('profilingStatus', true);
    }
  }

  captureScreenshot = ({ commitIndex }: { commitIndex: number }) => {
    this._bridge.send('captureScreenshot', { commitIndex });
  };

  getIDForNode(node: Object): number | null {
    for (let rendererID in this._rendererInterfaces) {
      // A renderer will throw if it can't find a fiber for the specified node.
      try {
        const renderer = ((this._rendererInterfaces[
          (rendererID: any)
        ]: any): RendererInterface);
        return renderer.getFiberIDFromNative(node, true);
      } catch (e) {}
    }
    return null;
  }

  exportProfilingSummary = ({
    profilingOperations,
    profilingSnapshot,
    rendererID,
    rootID,
  }: {
    profilingOperations: Array<any>,
    profilingSnapshot: Array<any>,
    rendererID: number,
    rootID: number,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}"`);
    } else {
      const rendererData = renderer.getProfilingDataForDownload(rootID);
      this._bridge.send('exportFile', {
        contents: JSON.stringify(
          {
            ...rendererData,
            profilingOperations,
            profilingSnapshot,
          },
          null,
          2
        ),
        filename: 'profile-data.json',
      });
    }
  };

  getCommitDetails = ({
    commitIndex,
    rendererID,
    rootID,
  }: {
    commitIndex: number,
    rendererID: number,
    rootID: number,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}"`);
    } else {
      this._bridge.send(
        'commitDetails',
        renderer.getCommitDetails(rootID, commitIndex)
      );
    }
  };

  getFiberCommits = ({
    fiberID,
    rendererID,
    rootID,
  }: {
    fiberID: number,
    rendererID: number,
    rootID: number,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}"`);
    } else {
      this._bridge.send(
        'fiberCommits',
        renderer.getFiberCommits(rootID, fiberID)
      );
    }
  };

  getInteractions = ({
    rendererID,
    rootID,
  }: {
    rendererID: number,
    rootID: number,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}"`);
    } else {
      this._bridge.send('interactions', renderer.getInteractions(rootID));
    }
  };

  getProfilingStatus = () => {
    this._bridge.send('profilingStatus', this._isProfiling);
  };

  getProfilingSummary = ({
    rendererID,
    rootID,
  }: {
    rendererID: number,
    rootID: number,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}"`);
    } else {
      this._bridge.send(
        'profilingSummary',
        renderer.getProfilingSummary(rootID)
      );
    }
  };

  clearHighlightedElementInDOM = () => {
    hideOverlay();
  };

  highlightElementInDOM = ({
    displayName,
    hideAfterTimeout,
    id,
    openNativeElementsPanel,
    rendererID,
    scrollIntoView,
  }: {
    displayName: string,
    hideAfterTimeout: boolean,
    id: number,
    openNativeElementsPanel: boolean,
    rendererID: number,
    scrollIntoView: boolean,
  }) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    }

    let node: HTMLElement | null = null;
    if (renderer !== null) {
      node = ((renderer.findNativeByFiberID(id): any): HTMLElement);
    }

    if (node != null) {
      if (scrollIntoView && typeof node.scrollIntoView === 'function') {
        // If the node isn't visible show it before highlighting it.
        // We may want to reconsider this; it might be a little disruptive.
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      showOverlay(((node: any): HTMLElement), displayName, hideAfterTimeout);
      if (openNativeElementsPanel) {
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__.$0 = node;
        this._bridge.send('syncSelectionToNativeElementsPanel');
      }
    } else {
      hideOverlay();
    }
  };

  inspectElement = ({ id, rendererID }: InspectSelectParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      this._bridge.send('inspectedElement', renderer.inspectElement(id));
    }
  };

  logElementToConsole = ({ id, rendererID }: InspectSelectParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.logElementToConsole(id);
    }
  };

  reloadAndProfile = () => {
    localStorage.setItem(LOCAL_STORAGE_RELOAD_AND_PROFILE_KEY, 'true');

    // This code path should only be hit if the shell has explicitly told the Store that it supports profiling.
    // In that case, the shell must also listen for this specific message to know when it needs to reload the app.
    // The agent can't do this in a way that is renderer agnostic.
    this._bridge.send('reloadAppForProfiling');
  };

  screenshotCaptured = ({
    commitIndex,
    dataURL,
  }: {|
    commitIndex: number,
    dataURL: string,
  |}) => {
    this._bridge.send('screenshotCaptured', { commitIndex, dataURL });
  };

  selectElement = ({ id, rendererID }: InspectSelectParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.selectElement(id);
      this._bridge.send('selectElement');

      const keyPath = renderer.getKeyPath(id);
      if (!this._lastRestoreResult || id !== this._lastRestoreResult.id) {
        this._stopRestoringKeyPath();
        this._storeKeyPathForNextLoad(rendererID, keyPath);
      }
      // TODO: If there was a way to change the selected DOM element
      // in native Elements tab without forcing a switch to it, we'd do it here.
      // For now, it doesn't seem like there is a way to do that:
      // https://github.com/bvaughn/react-devtools-experimental/issues/102
      // (Setting $0 doesn't work, and calling inspect() switches the tab.)
    }
  };

  overrideContext = ({ id, path, rendererID, value }: SetInParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.setInContext(id, path, value);
    }
  };

  overrideHookState = ({
    id,
    hookID,
    path,
    rendererID,
    value,
  }: OverrideHookParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.setInHook(id, hookID, path, value);
    }
  };

  overrideProps = ({ id, path, rendererID, value }: SetInParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.setInProps(id, path, value);
    }
  };

  overrideState = ({ id, path, rendererID, value }: SetInParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.setInState(id, path, value);
    }
  };

  overrideSuspense = ({
    id,
    rendererID,
    forceFallback,
  }: OverrideSuspenseParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.overrideSuspense(id, forceFallback);
    }
  };

  setRendererInterface(
    rendererID: RendererID,
    rendererInterface: RendererInterface
  ) {
    this._rendererInterfaces[rendererID] = rendererInterface;

    if (this._isProfiling) {
      rendererInterface.startProfiling();
    }

    if (this._keyPathToRestore && this._keyPathToRestore.rendererID === rendererID) {
      rendererInterface.setTrackedKeyPath(this._keyPathToRestore.keyPath);
    }
  }

  syncSelectionFromNativeElementsPanel = () => {
    const target = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.$0;
    if (target == null) {
      return;
    }
    const id = this.getIDForNode(target);
    if (id !== null) {
      this._bridge.send('selectFiber', id);
    }
  };

  shutdown = () => {
    // Clean up the overlay if visible, and associated events.
    this.stopInspectingDOM();
    this.emit('shutdown');
  };

  startInspectingDOM = () => {
    window.addEventListener('click', this._onClick, true);
    window.addEventListener('mousedown', this._onMouseDown, true);
    window.addEventListener('mouseup', this._onMouseUp, true);
    window.addEventListener('mouseover', this._onMouseOver, true);
  };

  startProfiling = () => {
    this._isProfiling = true;
    for (let rendererID in this._rendererInterfaces) {
      const renderer = ((this._rendererInterfaces[
        (rendererID: any)
      ]: any): RendererInterface);
      renderer.startProfiling();
    }
    this._bridge.send('profilingStatus', this._isProfiling);
  };

  stopInspectingDOM = () => {
    hideOverlay();

    window.removeEventListener('click', this._onClick, true);
    window.removeEventListener('mousedown', this._onMouseDown, true);
    window.removeEventListener('mouseup', this._onMouseUp, true);
    window.removeEventListener('mouseover', this._onMouseOver, true);
  };

  stopProfiling = () => {
    this._isProfiling = false;
    for (let rendererID in this._rendererInterfaces) {
      const renderer = ((this._rendererInterfaces[
        (rendererID: any)
      ]: any): RendererInterface);
      renderer.stopProfiling();
    }
    this._bridge.send('profilingStatus', this._isProfiling);
  };

  viewElementSource = ({ id, rendererID }: InspectSelectParams) => {
    const renderer = this._rendererInterfaces[rendererID];
    if (renderer == null) {
      console.warn(`Invalid renderer id "${rendererID}" for element "${id}"`);
    } else {
      renderer.prepareViewElementSource(id);
    }
  };

  onHookOperations = (operations: Uint32Array) => {
    if (__DEBUG__) {
      debug('onHookOperations', operations);
    }

    // TODO:
    // The chrome.runtime does not currently support transferables; it forces JSON serialization.
    // See bug https://bugs.chromium.org/p/chromium/issues/detail?id=927134
    //
    // Regarding transferables, the postMessage doc states:
    // If the ownership of an object is transferred, it becomes unusable (neutered)
    // in the context it was sent from and becomes available only to the worker it was sent to.
    //
    // Even though Chrome is eventually JSON serializing the array buffer,
    // using the transferable approach also sometimes causes it to throw:
    //   DOMException: Failed to execute 'postMessage' on 'Window': ArrayBuffer at index 0 is already neutered.
    //
    // See bug https://github.com/bvaughn/react-devtools-experimental/issues/25
    //
    // The Store has a fallback in place that parses the message as JSON if the type isn't an array.
    // For now the simplest fix seems to be to not transfer the array.
    // This will negatively impact performance on Firefox so it's unfortunate,
    // but until we're able to fix the Chrome error mentioned above, it seems necessary.
    //
    // this._bridge.send('operations', operations, [operations.buffer]);
    this._bridge.send('operations', operations);

    if (this._keyPathToRestore) {
      if (this._rendererInterfaces[this._keyPathToRestore.rendererID]) {
        const renderer =this._rendererInterfaces[this._keyPathToRestore.rendererID]
        const result = renderer.findFiberForTrackedKeyPath()
        if (result !== null) {
          if (!this._lastRestoreResult || result.levelsLeft < this._lastRestoreResult.levelsLeft) {
            this._lastRestoreResult = result;
            this._bridge.send('selectFiber', result.id);
          }
          if (result.levelsLeft === 0) {
            this._stopRestoringKeyPath();
          }
        }
      }
    }
  };

  _onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    this.stopInspectingDOM();
    this._bridge.send('stopInspectingDOM', true);
  };

  _onMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    this._selectFiberForNode(((event.target: any): HTMLElement));
  };

  // While we don't do anything here, this makes choosing
  // the inspected element less invasive and less likely
  // to dismiss e.g. a context menu.
  _onMouseUp = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  _onMouseOver = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const target = ((event.target: any): HTMLElement);

    // Don't pass the name explicitly.
    // It will be inferred from DOM tag and Fiber owner.
    showOverlay(target, null, false);

    this._selectFiberForNode(target);
  };

  _selectFiberForNode = throttle(
    memoize((node: HTMLElement) => {
      const id = this.getIDForNode(node);
      if (id !== null) {
        this._bridge.send('selectFiber', id);
      }
    }),
    200,
    // Don't change the selection in the very first 200ms
    // because those are usually unintentional as you lift the cursor.
    { leading: false }
  );

  _getSavedKeyPath = () => {
    const savedData = localStorage.getItem(LOCAL_STORAGE_LAST_KEYPATH_KEY)
    if (savedData !== null) {
      return JSON.parse(savedData);
    }
    return null;
  }

  _stopRestoringKeyPath = () => {
    if (this._keyPathToRestore) {
      if (this._rendererInterfaces[this._keyPathToRestore.rendererID]) {
        this._rendererInterfaces[this._keyPathToRestore.rendererID].setTrackedKeyPath(null);
      }
    }
    this._keyPathToRestore = null;
  };

  _storeKeyPathForNextLoad = (rendererID, keyPath) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_LAST_KEYPATH_KEY, JSON.stringify({
        rendererID,
        keyPath
      }));
    } catch (err) {
      // Ignore.
    }
  }
}
