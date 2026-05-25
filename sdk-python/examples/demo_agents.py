"""Run several demo THUAI agents against a local server.

The demo is intentionally simple: it connects multiple SDK agents, selects
strategy cards, places small orders, submits reports for news, and uses
``target_player_id`` when a player owns ``网络风暴``.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Iterable, Optional

from sdk_python.agent import Agent
from sdk_python.models import (
    GameState,
    MarketState,
    News,
    PlayerState,
    Prediction,
    ReportResult,
    SkillEffect,
    StrategyOptions,
    TradeNotification,
)


LOGGER = logging.getLogger("demo-agents")


@dataclass
class DemoMemory:
    """Small per-agent memory for avoiding duplicate actions."""

    selected_months: set[int] = field(default_factory=set)
    traded_months: set[int] = field(default_factory=set)
    activated_skills: set[tuple[int, str]] = field(default_factory=set)
    reported_news: set[int] = field(default_factory=set)
    last_stage: str = ""
    player_id_seen: Optional[int] = None


class DemoAgent(Agent):
    """Tiny callback-driven agent used for local end-to-end testing."""

    def __init__(self, token: str, server_url: str, index: int) -> None:
        super().__init__(token, server_url)
        self.index = index
        self.memory = DemoMemory()

    async def on_game_state(self, state: GameState) -> None:
        if state.stage != self.memory.last_stage:
            LOGGER.info(
                "%s stage=%s month=%s day=%s tick=%s scores=%s",
                self.token,
                state.stage,
                state.current_month,
                state.current_day,
                state.current_tick,
                [(score.player_id, score.score) for score in state.scores],
            )
            self.memory.last_stage = state.stage

    async def on_player_state(self, state: PlayerState) -> None:
        if self.memory.player_id_seen != state.player_id:
            LOGGER.info(
                "%s own player_id=%s nav=%s active_cards=%s",
                self.token,
                state.player_id,
                state.nav,
                state.active_cards,
            )
            self.memory.player_id_seen = state.player_id

        if self.game_state.stage == "TradingDay":
            await self._maybe_trade(state)
            await self._maybe_activate_skill(state)

    async def on_strategy_options(self, options: StrategyOptions) -> None:
        month = self.game_state.current_month
        if month in self.memory.selected_months:
            return

        choice = self._choose_card(options)
        if choice is None:
            return

        self.memory.selected_months.add(month)
        LOGGER.info("%s selecting card=%s month=%s", self.token, choice, month)
        await self.select_strategy(choice)

    async def on_market_state(self, state: MarketState) -> None:
        if state.tick % 10 == 0:
            LOGGER.debug(
                "%s market tick=%s mid=%s last=%s bid=%s ask=%s",
                self.token,
                state.tick,
                state.mid_price,
                state.last_price,
                state.bids[0].price if state.bids else "-",
                state.asks[0].price if state.asks else "-",
            )

    async def on_news(self, news: News) -> None:
        if news.news_id in self.memory.reported_news:
            return

        self.memory.reported_news.add(news.news_id)
        prediction = Prediction.LONG if self.index % 2 == 0 else Prediction.SHORT
        LOGGER.info(
            "%s reporting news_id=%s prediction=%s content=%s",
            self.token,
            news.news_id,
            prediction.value,
            news.content,
        )
        await self.submit_report(news.news_id, prediction)

    async def on_report_result(self, result: ReportResult) -> None:
        LOGGER.info(
            "%s report_result news_id=%s correct=%s reward=%s actual_change=%s",
            self.token,
            result.news_id,
            result.is_correct,
            result.reward,
            result.actual_change,
        )

    async def on_trade(self, trade: TradeNotification) -> None:
        LOGGER.info(
            "%s trade order=%s side=%s price=%s qty=%s fee=%s",
            self.token,
            trade.order_id,
            trade.side,
            trade.price,
            trade.quantity,
            trade.fee,
        )

    async def on_skill_effect(self, effect: SkillEffect) -> None:
        LOGGER.info(
            "%s saw skill=%s source_player_id=%s target_player_id=%s desc=%s",
            self.token,
            effect.skill_name,
            effect.source_player_id,
            effect.target_player_id,
            effect.description,
        )

    async def on_error(self, code: int, message: str) -> None:
        LOGGER.warning("%s server_error code=%s message=%s", self.token, code, message)

    def _choose_card(self, options: StrategyOptions) -> Optional[str]:
        cards = [
            options.infrastructure,
            options.risk_control,
            options.fin_tech,
        ]
        names = [card.name for card in cards if card is not None]

        if self.index == 0 and "网络风暴" in names:
            return "网络风暴"
        if self.index == 1 and "闪电交易" in names:
            return "闪电交易"
        if self.index == 2 and "止损名刀" in names:
            return "止损名刀"

        return names[self.index % len(names)] if names else None

    async def _maybe_trade(self, state: PlayerState) -> None:
        month = self.game_state.current_month
        if month in self.memory.traded_months:
            return
        if self.market_state.mid_price <= 0:
            return

        self.memory.traded_months.add(month)
        price = self.market_state.mid_price
        quantity = 1 + (self.index % 2)
        if self.index % 2 == 0:
            LOGGER.info("%s placing LIMIT_BUY price=%s qty=%s", self.token, price, quantity)
            await self.limit_buy(price, quantity)
        elif state.gold >= quantity:
            LOGGER.info("%s placing LIMIT_SELL price=%s qty=%s", self.token, price, quantity)
            await self.limit_sell(price, quantity)

    async def _maybe_activate_skill(self, state: PlayerState) -> None:
        for skill_name in state.active_cards:
            key = (self.game_state.current_month, skill_name)
            if key in self.memory.activated_skills:
                continue

            if skill_name == "网络风暴":
                target_player_id = self._target_player_id(state.player_id)
                if target_player_id is None:
                    continue
                self.memory.activated_skills.add(key)
                LOGGER.info(
                    "%s activating 网络风暴 target_player_id=%s",
                    self.token,
                    target_player_id,
                )
                await self.activate_skill("网络风暴", target_player_id=target_player_id)
                continue

            if skill_name == "内幕消息":
                self.memory.activated_skills.add(key)
                LOGGER.info("%s activating 内幕消息 variant=cheap", self.token)
                await self.activate_skill("内幕消息", variant="cheap")
                continue

            if skill_name in {"闪电交易", "止损名刀", "定向增发", "舆情打击"}:
                self.memory.activated_skills.add(key)
                LOGGER.info("%s activating %s", self.token, skill_name)
                await self.activate_skill(skill_name)

    def _target_player_id(self, own_player_id: int) -> Optional[int]:
        for score in self.game_state.scores:
            if score.player_id != own_player_id:
                return score.player_id
        return None


async def run_agents(tokens: Iterable[str], server_url: str, duration: float) -> None:
    agents = [DemoAgent(token, server_url, index) for index, token in enumerate(tokens)]
    tasks = [asyncio.create_task(agent.run(), name=f"demo-agent-{agent.token}") for agent in agents]
    try:
        await asyncio.sleep(duration)
    finally:
        for agent in agents:
            await agent.disconnect()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-url", default="ws://localhost:14514")
    parser.add_argument("--tokens", default="alpha,beta,gamma")
    parser.add_argument("--duration", type=float, default=90.0)
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    tokens = [token.strip() for token in args.tokens.split(",") if token.strip()]
    LOGGER.info("starting demo agents tokens=%s server=%s", tokens, args.server_url)
    asyncio.run(run_agents(tokens, args.server_url, args.duration))


if __name__ == "__main__":
    main()
