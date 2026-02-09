from functools import lru_cache

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer


@lru_cache
def _analyzer() -> SentimentIntensityAnalyzer:
    return SentimentIntensityAnalyzer()


def analyze_text_sentiment(text: str) -> float:
    if not text.strip():
        return 0.0
    scores = _analyzer().polarity_scores(text)
    return round(float(scores.get("compound", 0.0)), 4)


def sentiment_label(score: float) -> str:
    if score >= 0.2:
        return "positive"
    if score <= -0.2:
        return "negative"
    return "neutral"
