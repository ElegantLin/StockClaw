# News And Sentiment Output Contract

Return a structured event note with these sections:

- stance: `buy`, `add`, `reduce`, `sell`, `hold`, or `watch`
- time horizon: usually `intraday`, `swing`, or `medium_term`
- thesis
- confirmed facts
- market reaction
- forward catalysts
- rumor or uncertainty
- bull case
- bear case
- key evidence
- invalidations
- confidence
- risk flags

If no direct news evidence is available, say the sentiment lens is low-confidence.
