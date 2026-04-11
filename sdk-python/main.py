import asyncio
import logging
import os

from sdk_python.agent import Agent
from sdk_python.models import GameState, MarketState, News, PlayerState, Prediction, StrategyOptions

logging.basicConfig(level=logging.INFO)


class MyAgent(Agent):
    """Example agent -- random strategy card selection, no trading logic."""

    async def on_game_state(self, state: GameState):
        logging.info(f"Game: {state.stage} Day={state.current_day} Tick={state.current_tick}")

    async def on_market_state(self, state: MarketState):
        pass  # Implement your trading logic here

    async def on_player_state(self, state: PlayerState):
        pass  # Check your portfolio here

    async def on_news(self, news: News):
        logging.info(f"News [{news.news_id}]: {news.content}")
        # Example: submit a research report predicting Long
        await self.submit_report(news.news_id, Prediction.LONG)

    async def on_strategy_options(self, options: StrategyOptions):
        # Pick the first available card
        if options.infrastructure:
            await self.select_strategy(options.infrastructure.name)
        elif options.risk_control:
            await self.select_strategy(options.risk_control.name)
        elif options.fin_tech:
            await self.select_strategy(options.fin_tech.name)


async def main():
    token = os.environ.get("TOKEN", "player1")
    server = os.environ.get("SERVER", "ws://localhost:14514")
    agent = MyAgent(token=token, server_url=server)
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
