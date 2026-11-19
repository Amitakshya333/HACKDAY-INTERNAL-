import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ExecuteFixThatWhiteScreenIssue, createInstance } from '../execute-fix-that-white-screen-issue.js';

describe('Execute: FIX THAT WHITE SCREEN ISSUE Verification Suite', () => {
  test('initializes with default options and active status', () => {
    const instance = createInstance();
    assert.strictEqual(instance.status, 'initialized');
    const initRes = instance.initialize();
    assert.strictEqual(initRes.success, true);
    assert.strictEqual(instance.status, 'active');
  });

  test('executes actions and records state transitions', () => {
    const instance = createInstance();
    instance.initialize();
    const res = instance.execute('process', { testKey: 'testVal' });
    assert.strictEqual(res.status, 'executed');
    assert.strictEqual(res.action, 'process');
    assert.strictEqual(instance.getState('process').payload.testKey, 'testVal');
  });
});
