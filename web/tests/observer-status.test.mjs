import assert from "node:assert/strict";
import { describeObserverConnection, normalizeObserverMatch } from "../src/observer-status.js";

testNormalizeObserverMatch();
testDescribeObserverConnectionWithoutLiveMatch();
testDescribeObserverConnectionForPendingMatch();
testDescribeObserverConnectionForRunningMatch();
testDescribeObserverConnectionForConnectedMatch();
testDescribeObserverConnectionForFinishedMatch();

function testNormalizeObserverMatch() {
  assert.deepEqual(normalizeObserverMatch({ match_id: "12", status: "RUNNING" }), {
    matchId: 12,
    matchStatus: "running",
  });
  assert.deepEqual(normalizeObserverMatch({ match_id: "oops", status: "unknown" }), {
    matchId: null,
    matchStatus: "",
  });
}

function testDescribeObserverConnectionWithoutLiveMatch() {
  const description = describeObserverConnection({ matchId: null, matchStatus: "" }, { reconnectAttempt: 2 });

  assert.equal(description.status, "waiting");
  assert.equal(description.statusLabel, "等待下一场");
  assert.match(description.statusDetail, /自动重试连接/);
}

function testDescribeObserverConnectionForPendingMatch() {
  const description = describeObserverConnection({ matchId: 18, matchStatus: "pending" });

  assert.equal(description.status, "starting");
  assert.equal(description.statusLabel, "比赛即将开始");
  assert.match(description.statusDetail, /第 18 场对局/);
}

function testDescribeObserverConnectionForRunningMatch() {
  const description = describeObserverConnection(
    { matchId: 19, matchStatus: "running" },
    { reconnectAttempt: 1 },
  );

  assert.equal(description.status, "starting");
  assert.equal(description.statusLabel, "比赛启动中");
  assert.match(description.statusDetail, /自动重试连接/);
}

function testDescribeObserverConnectionForConnectedMatch() {
  const description = describeObserverConnection(
    { matchId: 20, matchStatus: "running" },
    { socketConnected: true },
  );

  assert.equal(description.status, "connected");
  assert.equal(description.statusLabel, "观战已连接");
  assert.match(description.statusDetail, /第 20 场对局/);
}

function testDescribeObserverConnectionForFinishedMatch() {
  const description = describeObserverConnection({ matchId: 21, matchStatus: "finished" });

  assert.equal(description.status, "waiting");
  assert.equal(description.statusLabel, "等待下一场");
  assert.match(description.statusDetail, /已结束/);
}
