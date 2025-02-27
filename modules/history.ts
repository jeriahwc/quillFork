import { Scope } from 'parchment';
import Delta from 'quill-delta';
import Module from '../core/module';
import Quill from '../core/quill';
import type Scroll from '../blots/scroll';

interface HistoryOptions {
  userOnly: boolean;
  delay: number;
  maxStack: number;
}

class History extends Module<HistoryOptions> {
  static DEFAULTS: HistoryOptions;

  lastRecorded: number;
  ignoreChange: boolean;
  stack: {
    undo: Delta[];
    redo: Delta[];
  };

  constructor(quill: Quill, options: Partial<HistoryOptions>) {
    super(quill, options);
    this.lastRecorded = 0;
    this.ignoreChange = false;
    this.clear();
    this.quill.on(
      Quill.events.EDITOR_CHANGE,
      (eventName, delta, oldDelta, source) => {
        if (eventName !== Quill.events.TEXT_CHANGE || this.ignoreChange) return;
        if (!this.options.userOnly || source === Quill.sources.USER) {
          this.record(delta, oldDelta);
        } else {
          this.transform(delta);
        }
      },
    );
    this.quill.keyboard.addBinding(
      { key: 'z', shortKey: true },
      this.undo.bind(this),
    );
    this.quill.keyboard.addBinding(
      { key: 'z', shortKey: true, shiftKey: true },
      this.redo.bind(this),
    );
    if (/Win/i.test(navigator.platform)) {
      this.quill.keyboard.addBinding(
        { key: 'y', shortKey: true },
        this.redo.bind(this),
      );
    }

    this.quill.root.addEventListener('beforeinput', event => {
      if (event.inputType === 'historyUndo') {
        this.undo();
        event.preventDefault();
      } else if (event.inputType === 'historyRedo') {
        this.redo();
        event.preventDefault();
      }
    });
  }

  change(source: 'undo' | 'redo', dest: 'redo' | 'undo') {
    if (this.stack[source].length === 0) return;
    const delta = this.stack[source].pop();
    if (!delta) return;
    const base = this.quill.getContents();
    const inverseDelta = delta.invert(base);
    this.stack[dest].push(inverseDelta);
    this.lastRecorded = 0;
    this.ignoreChange = true;
    this.quill.updateContents(delta, Quill.sources.USER);
    this.ignoreChange = false;
    const index = getLastChangeIndex(this.quill.scroll, delta);
    this.quill.setSelection(index, Quill.sources.USER);
  }

  clear() {
    this.stack = { undo: [], redo: [] };
  }

  cutoff() {
    this.lastRecorded = 0;
  }

  record(changeDelta: Delta, oldDelta: Delta) {
    if (changeDelta.ops.length === 0) return;
    this.stack.redo = [];
    let undoDelta = changeDelta.invert(oldDelta);
    const timestamp = Date.now();
    if (
      // @ts-expect-error Fix me later
      this.lastRecorded + this.options.delay > timestamp &&
      this.stack.undo.length > 0
    ) {
      const delta = this.stack.undo.pop();
      if (delta) {
        undoDelta = undoDelta.compose(delta);
      }
    } else {
      this.lastRecorded = timestamp;
    }
    if (undoDelta.length() === 0) return;
    this.stack.undo.push(undoDelta);
    // @ts-expect-error Fix me later
    if (this.stack.undo.length > this.options.maxStack) {
      this.stack.undo.shift();
    }
  }

  redo() {
    this.change('redo', 'undo');
  }

  transform(delta: Delta) {
    transformStack(this.stack.undo, delta);
    transformStack(this.stack.redo, delta);
  }

  undo() {
    this.change('undo', 'redo');
  }
}
History.DEFAULTS = {
  delay: 1000,
  maxStack: 100,
  userOnly: false,
};

function transformStack(stack: Delta[], delta: Delta) {
  let remoteDelta = delta;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const oldDelta = stack[i];
    stack[i] = remoteDelta.transform(oldDelta, true);
    remoteDelta = oldDelta.transform(remoteDelta);
    if (stack[i].length() === 0) {
      stack.splice(i, 1);
    }
  }
}

function endsWithNewlineChange(scroll: Scroll, delta: Delta) {
  const lastOp = delta.ops[delta.ops.length - 1];
  if (lastOp == null) return false;
  if (lastOp.insert != null) {
    return typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n');
  }
  if (lastOp.attributes != null) {
    return Object.keys(lastOp.attributes).some(attr => {
      return scroll.query(attr, Scope.BLOCK) != null;
    });
  }
  return false;
}

function getLastChangeIndex(scroll: Scroll, delta: Delta) {
  const deleteLength = delta.reduce((length, op) => {
    return length + (op.delete || 0);
  }, 0);
  let changeIndex = delta.length() - deleteLength;
  if (endsWithNewlineChange(scroll, delta)) {
    changeIndex -= 1;
  }
  return changeIndex;
}

export { History as default, getLastChangeIndex };
