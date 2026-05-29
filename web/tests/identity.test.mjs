import assert from "node:assert/strict";
import {
  applyMessage,
  applyPlayerMap,
  createInitialState,
  playerDisplayName,
} from "../src/store.js";

testApplyPlayerMapKeysByPlayerId();
testApplyPlayerMapIgnoresBadInput();
testObserverShowsTeamNameNotToken();
testObserverFallsBackToGenericLabel();
testReplayNeverUsesLivePollLabels();
testPlayerMapDoesNotGetClobberedByIdentity();

function observerState() {
  const state = createInitialState({ role: "observer" });
  state.connection.role = "observer";
  return state;
}

function testApplyPlayerMapKeysByPlayerId() {
  const state = observerState();
  applyPlayerMap(state, [
    { player_id: 0, team_id: 7, team_name: "红队" },
    { player_id: 1, team_id: 9, team_name: "蓝队" },
  ]);
  assert.equal(state.playerDirectory.labelsById[0], "红队");
  assert.equal(state.playerDirectory.labelsById[1], "蓝队");
}

function testApplyPlayerMapIgnoresBadInput() {
  const state = observerState();
  applyPlayerMap(state, null);
  applyPlayerMap(state, undefined);
  applyPlayerMap(state, [
    { player_id: -1, team_name: "无效" }, // negative id dropped
    { player_id: 2, team_name: "" }, // empty name dropped
    { team_name: "缺 id" }, // missing id dropped
  ]);
  assert.deepEqual(state.playerDirectory.labelsById, {});
}

function testObserverShowsTeamNameNotToken() {
  const state = observerState();
  applyPlayerMap(state, [{ player_id: 0, team_id: 7, team_name: "红队" }]);
  // Even if a (secret) token is passed in, the observer view must surface the
  // team name and never echo the token.
  assert.equal(playerDisplayName(state, 0, "super-secret-token"), "红队");
}

function testObserverFallsBackToGenericLabel() {
  const state = observerState();
  assert.equal(playerDisplayName(state, 3, ""), "选手 3");
  assert.equal(playerDisplayName(state, -1, ""), "-");
}

function testReplayNeverUsesLivePollLabels() {
  const state = observerState();
  // Live poll labelled player 0 as 红队 for the *current* match...
  applyPlayerMap(state, [{ player_id: 0, team_id: 7, team_name: "红队" }]);
  // ...but we are now replaying an unrelated past match.
  state.replay.enabled = true;
  // The replay payload carries its own token — that wins, the live label is ignored.
  assert.equal(playerDisplayName(state, 0, "m5s12"), "m5s12");
  // With no token in the replay payload, fall back to a generic label, NOT 红队.
  assert.equal(playerDisplayName(state, 0, ""), "选手 0");
}

function testPlayerMapDoesNotGetClobberedByIdentity() {
  const state = observerState();
  applyPlayerMap(state, [{ player_id: 0, team_id: 7, team_name: "红队" }]);
  // A later PLAYER_STATE (token-based identity) must not overwrite the team name.
  applyMessage(state, { messageType: "PLAYER_STATE", playerId: 0, token: "tok0" });
  assert.equal(state.playerDirectory.labelsById[0], "红队");
  assert.equal(state.playerDirectory.idsByToken["tok0"], 0);
}
