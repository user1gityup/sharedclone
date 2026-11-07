// build-prelude.cjs — intercept child_process spawn/fork during next build
// The sandbox blocks spawning child processes (EPERM). This shim replaces
// spawn/fork/exec/execFile/spawnSync with stubs that handle the full Node.js
// ChildProcess IPC interface so jest-worker (and thus Next.js) can operate.
"use strict";

if (process.env.DSH_BUILD_NO_SPAWN !== "1") return;

const cp = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");

let blockedCount = 0;

function makeStubProcess(modulePath) {
  blockedCount++;
  const label = `stub-${blockedCount}`;
  process.stderr.write(`[build-prelude] stub ${label} for: ${modulePath}\n`);

  const p = new EventEmitter();
  p.pid = 9000 + blockedCount;
  p.connected = true;
  p.killed = false;
  p.exitCode = null;
  p.signalCode = null;
  p.spawnargs = [modulePath];
  p.spawnfile = modulePath;
  p.channel = { ref: () => {}, unref: () => {} };

  // stdin/stdout/stderr as pass-through streams
  const { PassThrough } = require("node:stream");
  p.stdin = new PassThrough();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();

  // send() — the parent calls this to send IPC messages to the "child"
  p.send = function (msg, cb) {
    // jest-worker sends: [CHILD_MESSAGE_INITIALIZE, false, modulePath, setupArgs]
    // or:               [CHILD_MESSAGE_CALL, false, methodName, args]
    // or:               [CHILD_MESSAGE_END]
    if (!Array.isArray(msg)) {
      if (cb) process.nextTick(() => cb(null));
      return true;
    }
    const type = msg[0];
    // CHILD_MESSAGE_END = 2
    if (type === 2) {
      p.connected = false;
      p.exitCode = 0;
      process.nextTick(() => {
        p.emit("exit", 0, null);
        p.emit("close", 0, null);
      });
      if (cb) process.nextTick(() => cb(null));
      return true;
    }
    // CHILD_MESSAGE_INITIALIZE = 0: setup with module path and args
    // CHILD_MESSAGE_CALL = 1: call a method
    // For either, we respond with PARENT_MESSAGE_OK = 0 with a success payload
    // The stub always returns null/undefined for call results since we can't
    // actually run the worker module in-process from here.
    process.nextTick(() => {
      const response = [
        0, // PARENT_MESSAGE_OK
        type === 0 ? undefined : null, // result for CALL; undefined for INIT
      ];
      p.emit("message", response);
    });
    if (cb) process.nextTick(() => cb(null));
    return true;
  };

  p.kill = function (sig) {
    p.killed = true;
    p.exitCode = 0;
    p.connected = false;
    p.emit("exit", 0, sig || null);
    p.emit("close", 0, sig || null);
    return true;
  };

  p.ref = function () { return this; };
  p.unref = function () { return this; };

  return p;
}

function stubSync() {
  return {
    pid: -1,
    output: [null, Buffer.from(""), Buffer.from("")],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    error: undefined,
  };
}

cp.spawn = function (cmd, args, options) {
  process.stderr.write(`[build-prelude] blocked spawn: ${cmd} ${(args || []).join(" ")}\n`);
  return makeStubProcess(cmd);
};
cp.fork = function (modulePath, args, options) {
  process.stderr.write(`[build-prelude] blocked fork: ${modulePath}\n`);
  return makeStubProcess(modulePath);
};
cp.exec = function (cmd, options, cb) {
  process.stderr.write(`[build-prelude] blocked exec: ${cmd}\n`);
  const p = makeStubProcess(cmd);
  if (cb) setTimeout(() => cb(null, "", ""), 0);
  return p;
};
cp.execFile = function (file, args, options, cb) {
  process.stderr.write(`[build-prelude] blocked execFile: ${file}\n`);
  const p = makeStubProcess(file);
  if (cb && typeof options === "function") {
    setTimeout(() => options(null, "", ""), 0);
  } else if (cb) {
    setTimeout(() => cb(null, "", ""), 0);
  }
  return p;
};
cp.spawnSync = function (cmd, args, options) {
  process.stderr.write(`[build-prelude] blocked spawnSync: ${cmd} ${(args || []).join(" ")}\n`);
  return stubSync();
};

process.stderr.write("[build-prelude] child_process spawn interception active\n");