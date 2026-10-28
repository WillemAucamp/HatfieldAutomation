import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubOutputLines, planScheduledPipeline, resolvePipelinePlan } from "./pendingWork.js";

describe("planScheduledPipeline", () => {
  it("skips idle ticks", () => {
    const plan = planScheduledPipeline({ intake: 0, loadable: 0, approved: 0 });
    assert.equal(plan.shouldRun, false);
    assert.match(plan.reason, /idle/);
  });

  it("runs when new Form rows exist", () => {
    const plan = planScheduledPipeline({ intake: 2, loadable: 0, approved: 0 });
    assert.equal(plan.shouldRun, true);
    assert.match(plan.reason, /2 unprocessed Form/);
  });

  it("runs when leftover blank-Status rows exist", () => {
    const plan = planScheduledPipeline({ intake: 0, loadable: 1, approved: 0 });
    assert.equal(plan.shouldRun, true);
    assert.match(plan.reason, /blank\/repairable/);
  });

  it("runs when Approved leads still need copying", () => {
    const plan = planScheduledPipeline({ intake: 0, loadable: 0, approved: 3 });
    assert.equal(plan.shouldRun, true);
    assert.match(plan.reason, /Approved lead/);
  });
});

describe("resolvePipelinePlan", () => {
  it("always runs when idle probe is off", () => {
    const plan = resolvePipelinePlan({ intake: 0, loadable: 0, approved: 0 }, false);
    assert.equal(plan.shouldRun, true);
    assert.match(plan.reason, /manual run/);
  });

  it("delegates to planScheduledPipeline when idle probe is on", () => {
    const plan = resolvePipelinePlan({ intake: 0, loadable: 0, approved: 0 }, true);
    assert.equal(plan.shouldRun, false);
  });
});

describe("githubOutputLines", () => {
  it("writes Actions step outputs", () => {
    assert.deepEqual(
      githubOutputLines(planScheduledPipeline({ intake: 1, loadable: 4, approved: 0 })),
      ["should_run=true", "intake=1", "loadable=4", "approved=0"]
    );
  });
});
