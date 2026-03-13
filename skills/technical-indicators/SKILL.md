---
name: technical-indicators
description: Calculate technical analysis indicators for stock market analysis
---

# Technical Indicators Calculator

Quick guide for calculating technical indicators using Python and pandas-ta.

## Quick Start

```python
import yfinance as yf
import pandas_ta as ta

df = yf.download('AAPL', period='1y')
df['RSI'] = ta.rsi(df['Close'], length=14)
print(df[['Close', 'RSI']].tail())
```

## Key Indicators

### 1. RSI (Relative Strength Index)
```python
df['RSI'] = ta.rsi(df['Close'], length=14)
# RSI > 70: overbought | RSI < 30: oversold
```

### 2. SMA (Simple Moving Average)
```python
df['SMA_50'] = ta.sma(df['Close'], length=50)
# Golden Cross: SMA_50 > SMA_200
# Death Cross: SMA_50 < SMA_200
```

### 3. EMA (Exponential Moving Average)
```python
df['EMA_12'] = ta.ema(df['Close'], length=12)
```

### 4. MACD
```python
macd = ta.macd(df['Close'])
# MACD > Signal: bullish | MACD < Signal: bearish
```

### 5. Bollinger Bands
```python
bbands = ta.bbands(df['Close'], length=20)
# Price > Upper: overbought | Price < Lower: oversold
```

### 6. ADX (Trend Strength)
```python
adx = ta.adx(df['High'], df['Low'], df['Close'], length=14)
# ADX > 25: strong trend | ADX < 20: weak trend
```

### 7. ATR (Volatility)
```python
df['ATR'] = ta.atr(df['High'], df['Low'], df['Close'], length=14)
```

### 8. Stochastic Oscillator
```python
stoch = ta.stoch(df['High'], df['Low'], df['Close'], length=14)
```

### 9. OBV (On-Balance Volume)
```python
df['OBV'] = ta.obv(df['Close'], df['Volume'])
```

## Complete Example

```python
import yfinance as yf
import pandas as pd
import pandas_ta as ta

# Fetch data
ticker = 'AAPL'
df = yf.download(ticker, period='2y')

# Calculate multiple indicators
df['RSI'] = ta.rsi(df['Close'], length=14)
df['SMA_20'] = ta.sma(df['Close'], length=20)
df['SMA_50'] = ta.sma(df['Close'], length=50)
df['EMA_12'] = ta.ema(df['Close'], length=12)

# MACD
macd = ta.macd(df['Close'])
df = pd.concat([df, macd], axis=1)

# Bollinger Bands
bbands = ta.bbands(df['Close'], length=20)
df = pd.concat([df, bbands], axis=1)

# ATR
df['ATR'] = ta.atr(df['High'], df['Low'], df['Close'], length=14)

print(df[['Close', 'RSI', 'SMA_20', 'SMA_50', 'ATR']].tail())
```

## Resources

- pandas-ta: https://pandas-ta.readthedocs.io/
- yfinance: https://github.com/ranaroussi/yfinance
- TA-Lib: https://ta-lib.org/
