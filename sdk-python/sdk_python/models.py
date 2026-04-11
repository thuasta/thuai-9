from dataclasses import dataclass, field
from enum import Enum


class GameStage(Enum):
    WAITING = "Waiting"
    PREPARING = "PreparingGame"
    STRATEGY = "StrategySelection"
    TRADING = "TradingDay"
    SETTLEMENT = "Settlement"
    FINISHED = "Finished"


class Prediction(Enum):
    LONG = "Long"
    SHORT = "Short"
    HOLD = "Hold"


@dataclass
class PriceLevel:
    price: int
    quantity: int


@dataclass
class OrderInfo:
    order_id: int
    side: str
    price: int
    quantity: int
    remaining_quantity: int
    status: str


@dataclass
class CardOption:
    name: str
    description: str
    category: str


@dataclass
class PlayerScore:
    token: str
    score: int


@dataclass
class GameState:
    stage: str = ""
    current_day: int = 0
    current_tick: int = 0
    total_ticks: int = 0
    scores: list[PlayerScore] = field(default_factory=list)


@dataclass
class MarketState:
    bids: list[PriceLevel] = field(default_factory=list)
    asks: list[PriceLevel] = field(default_factory=list)
    last_price: int = 0
    mid_price: int = 0
    volume: int = 0
    tick: int = 0


@dataclass
class PlayerState:
    mora: int = 0
    frozen_mora: int = 0
    gold: int = 0
    frozen_gold: int = 0
    locked_gold: int = 0
    nav: int = 0
    active_cards: list[str] = field(default_factory=list)
    pending_orders: list[OrderInfo] = field(default_factory=list)


@dataclass
class News:
    news_id: int = 0
    content: str = ""
    publish_tick: int = 0


@dataclass
class ReportResult:
    news_id: int = 0
    prediction: str = ""
    is_correct: bool = False
    reward: int = 0
    actual_change: int = 0


@dataclass
class StrategyOptions:
    infrastructure: CardOption | None = None
    risk_control: CardOption | None = None
    fin_tech: CardOption | None = None


@dataclass
class TradeNotification:
    trade_id: int = 0
    order_id: int = 0
    price: int = 0
    quantity: int = 0
    side: str = ""
    fee: int = 0


@dataclass
class SkillEffect:
    skill_name: str = ""
    source_player: str = ""
    description: str = ""
