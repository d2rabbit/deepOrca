// Injected via NODE_OPTIONS=--import to simulate a fully offline environment:
// every fetch fails, so any successful search must come from the local index.
globalThis.fetch = () => Promise.reject(new Error("offline: network disabled by test shim"));
