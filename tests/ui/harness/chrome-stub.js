// Fake `chrome` for viewing the built popup / options page in a plain browser tab.
// Injected before any page script by tests/ui/harness/screenshot.ts. The fake service worker
// replays a canned JobState and applies the panel's messages (pick, mode, dismiss, stop…) to it.
(function () {
  function makeEvent() {
    var listeners = new Set();
    return {
      addListener: function (f) { listeners.add(f); },
      removeListener: function (f) { listeners.delete(f); },
      hasListener: function (f) { return listeners.has(f); },
      _emit: function () {
        var args = arguments;
        listeners.forEach(function (f) { f.apply(null, args); });
      },
    };
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  window.__installChromeStub = function (cfg) {
    var state = cfg.state ? clone(cfg.state) : null;
    var store = { settings: clone(cfg.settings), history: clone(cfg.history || []) };
    var storageChanged = makeEvent();
    var ports = new Set();
    var sent = [];
    window.__sent = sent;
    window.__opened = [];

    function deliver(msg) { ports.forEach(function (p) { p._deliver(clone(msg)); }); }
    function emit() { deliver({ type: 'STATE', state: state }); }
    function all() { return state ? state.support.concat(state.pushback) : []; }

    function setStorage(obj) {
      var changes = {};
      Object.keys(obj).forEach(function (k) {
        changes[k] = { oldValue: clone(store[k]), newValue: clone(obj[k]) };
        store[k] = clone(obj[k]);
      });
      setTimeout(function () { storageChanged._emit(changes, 'local'); }, 0);
    }

    function handle(msg) {
      sent.push(msg);
      switch (msg.type) {
        case 'GET_STATE':
          setTimeout(emit, 5);
          if (cfg.hint) setTimeout(function () { deliver({ type: 'HINT', message: cfg.hint }); }, 60);
          return;
        case 'TOGGLE_PICK': {
          var i = state.picked.indexOf(msg.candidateId);
          if (i >= 0) state.picked.splice(i, 1);
          else state.picked.push(msg.candidateId);
          return emit();
        }
        case 'SET_MODE':
          if (state) state.mode = msg.mode;
          store.settings.lastMode = msg.mode;
          return emit();
        case 'DISMISS_REFINE':
          state.refineDismissed = true;
          return emit();
        case 'MARK_NOT_RELEVANT':
          state.notRelevant.push(msg.candidateId);
          state.support = state.support.filter(function (r) { return r.candidateId !== msg.candidateId; });
          state.pushback = state.pushback.filter(function (r) { return r.candidateId !== msg.candidateId; });
          return emit();
        case 'STOP_JOB':
          state.status = 'stopped';
          state.refining = undefined;
          return emit();
        case 'ANSWER_REFINE':
        case 'SEARCH_AGAIN':
          state.status = 'planning';
          state.refining = 'Refining: ' + (msg.freeText || msg.answers.map(function (a) { return a.answer; }).join(', '));
          state.refine = undefined;
          state.progress = { stage: 'planning', message: 'Updating the search plan…', percent: 5 };
          return emit();
        case 'SAVE_HISTORY': {
          var picked = state.picked
            .map(function (id) { return all().find(function (r) { return r.candidateId === id; }); })
            .filter(Boolean);
          var entry = {
            jobId: state.jobId, claim: state.rawClaim, normalizedClaim: state.plan && state.plan.normalizedClaim,
            mode: state.mode, answers: state.answers, picked: picked, outputs: { markdown: '' }, savedAt: Date.now(),
          };
          setStorage({ history: [entry].concat(store.history.filter(function (e) { return e.jobId !== entry.jobId; })) });
          return;
        }
        case 'REVERIFY_LIVE':
          setTimeout(function () {
            deliver({ type: 'REVERIFY_RESULT', candidateId: msg.candidateId, ok: true, message: 'Passage found verbatim on the live page.' });
          }, 300);
          return;
        case 'START_JOB':
          state = clone(cfg.startState || cfg.state);
          state.jobId = 'job_' + Date.now();
          state.rawClaim = msg.claim;
          state.mode = msg.mode;
          return emit();
        case 'RETRY_JOB':
          state.status = 'searching';
          state.progress = { stage: 'searching', message: 'Searching sources…', percent: 12 };
          return emit();
        case 'CLEAR_JOB':
          state = null;
          return emit();
      }
    }

    var chromeStub = {
      runtime: {
        id: 'backed-harness',
        lastError: undefined,
        connect: function (info) {
          var onMessage = makeEvent();
          var onDisconnect = makeEvent();
          var port = {
            name: info && info.name,
            onMessage: onMessage,
            onDisconnect: onDisconnect,
            postMessage: function (m) {
              var copy = clone(m);
              setTimeout(function () { handle(copy); }, 0);
            },
            disconnect: function () { ports.delete(port); },
            _deliver: function (m) { onMessage._emit(m, port); },
          };
          ports.add(port);
          return port;
        },
        openOptionsPage: function () { window.__opened.push('options'); return Promise.resolve(); },
        getURL: function (p) { return p; },
        getPlatformInfo: function () { return Promise.resolve({}); },
      },
      storage: {
        local: {
          get: function (key) {
            if (typeof key === 'string') {
              var out = {};
              if (store[key] !== undefined) out[key] = clone(store[key]);
              return Promise.resolve(out);
            }
            return Promise.resolve(clone(store));
          },
          set: function (obj) { setStorage(obj); return Promise.resolve(); },
        },
        onChanged: storageChanged,
      },
      permissions: {
        contains: function () { return Promise.resolve(!!cfg.pageAccess); },
        request: function () { cfg.pageAccess = true; return Promise.resolve(true); },
        remove: function () { cfg.pageAccess = false; return Promise.resolve(true); },
        onAdded: makeEvent(),
        onRemoved: makeEvent(),
      },
      tabs: {
        create: function (o) { window.__opened.push(o.url); return Promise.resolve({}); },
      },
    };
    Object.defineProperty(window, 'chrome', { value: chromeStub, configurable: true, writable: true });
  };
})();
