#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "yfinance>=0.2.40",
# ]
# ///

import argparse
import json
import time
import warnings
from datetime import datetime

import yfinance as yf

warnings.filterwarnings("ignore", category=DeprecationWarning)


def normalize_input_symbol(symbol: str) -> tuple[str, str]:
    raw = symbol.strip()
    upper = raw.upper()
    if upper.endswith(".US"):
        return raw, raw[:-3]
    return raw, raw


def parse_date(value: str, label: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise SystemExit(f"Invalid {label} '{value}'. Expected YYYY-MM-DD.") from exc


def fetch_history(symbol: str, start: str, end: str, retries: int = 4) -> list[dict]:
    source_symbol, yahoo_symbol = normalize_input_symbol(symbol)
    last_error: Exception | None = None

    for attempt in range(retries):
        if attempt > 0:
            time.sleep(min(5 * (2 ** (attempt - 1)), 20))
        try:
            ticker = yf.Ticker(yahoo_symbol)
            frame = ticker.history(
                start=start,
                end=end,
                interval="1d",
                auto_adjust=False,
                raise_errors=True,
            )
            if frame.empty:
                return []
            bars: list[dict] = []
            for idx, row in frame.iterrows():
                bars.append(
                    {
                        "date": idx.strftime("%Y-%m-%d"),
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": int(row["Volume"]) if "Volume" in row and row["Volume"] == row["Volume"] else None,
                        "rawTime": idx.isoformat(),
                    }
                )
            return bars
        except Exception as exc:  # pragma: no cover
            last_error = exc

    message = str(last_error) if last_error else "unknown error"
    raise RuntimeError(f"{source_symbol}: {message}")


def run_history(args: argparse.Namespace) -> int:
    start = parse_date(args.start, "start")
    end = parse_date(args.end, "end")
    if end <= start:
        raise SystemExit("--end must be later than --start.")

    bars_by_symbol: dict[str, list[dict]] = {}
    warnings: list[str] = []
    errors: list[str] = []

    for index, symbol in enumerate(args.symbols):
        if index > 0:
            time.sleep(1)
        try:
            bars = fetch_history(symbol, start, end)
            if not bars:
                warnings.append(f"{symbol}: no daily bars were returned for the requested window.")
                continue
            bars_by_symbol[symbol] = bars
        except Exception as exc:  # pragma: no cover
            errors.append(str(exc))

    payload = {
        "provider": {
            "server": "skill:yahoo-finance",
            "historyTool": "yf history",
            "tradeDatesTool": None,
            "frequency": "1d",
            "adjustFlag": "0",
            "format": "json",
            "sourceSummary": "Daily OHLC bars resolved through the local yahoo-finance skill using yfinance.",
            "toolchain": ["skill:yahoo-finance", "uv", "yfinance"],
        },
        "calendar": sorted({bar["date"] for rows in bars_by_symbol.values() for bar in rows}),
        "barsBySymbol": bars_by_symbol,
        "warnings": warnings,
        "errors": errors,
    }

    if args.output == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(f"Resolved history for {len(bars_by_symbol)} symbol(s).")
        for symbol, rows in bars_by_symbol.items():
            print(f"- {symbol}: {len(rows)} bar(s)")
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")
        if errors:
            print("Errors:")
            for error in errors:
                print(f"- {error}")

    return 0 if bars_by_symbol and not errors else 1


def run_price(args: argparse.Namespace) -> int:
    quotes: dict[str, dict] = {}
    errors: list[str] = []
    for symbol in args.symbols:
        source_symbol, yahoo_symbol = normalize_input_symbol(symbol)
        try:
            ticker = yf.Ticker(yahoo_symbol)
            quotes[source_symbol] = {
                "symbol": source_symbol,
                "price": ticker.info.get("currentPrice"),
            }
        except Exception as exc:  # pragma: no cover
            errors.append(f"{source_symbol}: {exc}")

    payload = {"quotes": quotes, "errors": errors}
    if args.output == "json":
        print(json.dumps(payload, indent=2))
    else:
        for symbol, quote in quotes.items():
            print(f"{symbol}: {quote['price']}")
        for error in errors:
            print(error)
    return 0 if quotes and not errors else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Yahoo Finance helper for price and historical OHLC data.")
    subparsers = parser.add_subparsers(dest="command", required=False)

    history = subparsers.add_parser("history", help="Fetch daily OHLC history for one or more symbols.")
    history.add_argument("symbols", nargs="+", help="Ticker symbols such as AAPL.US or MSFT.US")
    history.add_argument("--start", required=True, help="Inclusive start date in YYYY-MM-DD")
    history.add_argument("--end", required=True, help="Exclusive end date in YYYY-MM-DD")
    history.add_argument("--output", choices=["text", "json"], default="text")
    history.set_defaults(handler=run_history)

    price = subparsers.add_parser("price", help="Fetch current price for one or more symbols.")
    price.add_argument("symbols", nargs="+", help="Ticker symbols such as AAPL.US or MSFT.US")
    price.add_argument("--output", choices=["text", "json"], default="text")
    price.set_defaults(handler=run_price)

    parser.set_defaults(command="price", handler=run_price, symbols=[])
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "price" and not args.symbols:
        parser.error("price requires at least one symbol.")
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
