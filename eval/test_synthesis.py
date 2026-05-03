"""
DeepEval test suite for Agent 7b (synthesis) and agentIPS outputs.

Setup:
  pip install -r eval/requirements.txt
  export ANTHROPIC_API_KEY=...     # used as the evaluation LLM judge

Collect fixtures first:
  python eval/collect_fixtures.py

Run:
  deepeval test run eval/test_synthesis.py
  # or for one fixture:
  deepeval test run eval/test_synthesis.py::test_synthesis_faithfulness[aggressive_growth_long_horizon]

Metrics used:
  FaithfulnessMetric    — does the narrative only reference facts that exist in the plan context?
  AnswerRelevancyMetric — are keyInsights relevant to the specific client profile?
  HallucinationMetric   — does primaryRisk invent warnings not present in riskAnalysis?
  GEval (custom)        — does the narrative reference actual ticker symbols from the allocation?
  GEval (custom)        — are actionableNextSteps specific and actionable?
  FaithfulnessMetric    — IPS executive summary faithfulness
  AnswerRelevancyMetric — IPS rebalancing policy consistency with time horizon
"""

import json
import pathlib
import pytest

from deepeval import assert_test
from deepeval.metrics import (
    FaithfulnessMetric,
    AnswerRelevancyMetric,
    HallucinationMetric,
    GEval,
)
from deepeval.models import AnthropicModel
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"

# ── Judge model — Claude via Anthropic (requires ANTHROPIC_API_KEY) ───────────
JUDGE_MODEL = AnthropicModel(
    model="claude-3-5-sonnet-latest",
    temperature=0,
)

FAITHFULNESS_THRESHOLD   = 0.80
RELEVANCY_THRESHOLD      = 0.70
HALLUCINATION_THRESHOLD  = 0.15   # lower = stricter (max allowed hallucination rate)
TICKER_MENTION_THRESHOLD = 0.75   # fraction of holdings that must appear in narrative


def load_fixtures() -> list[tuple[str, dict]]:
    if not FIXTURES_DIR.exists():
        pytest.skip("No fixtures found — run `python eval/collect_fixtures.py` first")
    files = sorted(FIXTURES_DIR.glob("*.json"))
    if not files:
        pytest.skip("No fixtures found — run `python eval/collect_fixtures.py` first")
    return [(f.stem, json.loads(f.read_text())) for f in files]


def build_retrieval_context(plan: dict) -> list[str]:
    """Construct the context that Agent 7b was given — used by faithfulness + hallucination metrics."""
    p = plan.get("portfolio", {})
    r = plan.get("riskAnalysis", {})
    m = plan.get("economicIntel", {})
    c = plan.get("criticScore", {})
    cp = plan.get("clientProfile", {})

    alloc = p.get("allocation", [])
    holdings = ", ".join(
        f"{s['ticker']} ({s['weight'] * 100:.1f}%)" for s in alloc
    )
    stats = p.get("statistics", {})
    scores = c.get("scores", {})
    profile = cp.get("riskProfile", {})
    horizon = cp.get("timeHorizon", {})
    tax = cp.get("taxProfile", {})

    return [
        f"Portfolio holdings: {holdings}",
        f"Expected return: {stats.get('expectedReturn', 0) * 100:.2f}%, "
        f"Volatility: {stats.get('expectedVolatility', 0) * 100:.2f}%, "
        f"Sharpe: {stats.get('sharpeRatio', 0):.2f}",
        f"Risk level: {r.get('riskLevel', 'unknown')}, "
        f"Warnings: {r.get('warnings', [])}",
        f"Macro regime: {m.get('regime', {}).get('current', 'unknown')}, "
        f"CAPE: {m.get('macroData', {}).get('shillerCAPE', 0)}, "
        f"Data source: {m.get('dataSource', 'unknown')}",
        f"Critic score: {scores.get('overall', 0)}/100 "
        f"(alignment={scores.get('alignment', 0)}, risk={scores.get('riskManagement', 0)}, "
        f"tax={scores.get('taxEfficiency', 0)})",
        f"Client risk score: {profile.get('riskScore', 0)}/10, "
        f"horizon: {horizon.get('yearsToGoal', 0)} years, "
        f"combined tax rate: {tax.get('combinedMarginalRate', 0) * 100:.0f}%",
    ]


# ── Synthesis (Agent 7b) tests ────────────────────────────────────────────────

@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_synthesis_faithfulness(scenario: str, plan: dict) -> None:
    """Narrative must not reference facts not present in the V3Plan context."""
    synthesis = plan.get("synthesis")
    if synthesis is None:
        pytest.skip(f"{scenario}: synthesis absent (GEMINI_API_KEY not set)")

    test_case = LLMTestCase(
        input=f"Write investment narrative for client (scenario: {scenario})",
        actual_output=synthesis["portfolioNarrative"],
        retrieval_context=build_retrieval_context(plan),
    )
    assert_test(test_case, [
        FaithfulnessMetric(threshold=FAITHFULNESS_THRESHOLD, model=JUDGE_MODEL, verbose_mode=True),
    ])


@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_synthesis_relevancy(scenario: str, plan: dict) -> None:
    """keyInsights must be relevant to this specific client's profile."""
    synthesis = plan.get("synthesis")
    if synthesis is None:
        pytest.skip(f"{scenario}: synthesis absent")

    client = plan.get("clientProfile", {})
    profile = client.get("riskProfile", {})
    tax = client.get("taxProfile", {})
    horizon = client.get("timeHorizon", {})

    query = (
        f"Investment insights for: risk {profile.get('riskScore', 0)}/10, "
        f"{horizon.get('yearsToGoal', 0)} year horizon, "
        f"{tax.get('combinedMarginalRate', 0) * 100:.0f}% combined tax rate"
    )
    actual = "\n".join(synthesis.get("keyInsights", []))

    test_case = LLMTestCase(input=query, actual_output=actual)
    assert_test(test_case, [
        AnswerRelevancyMetric(threshold=RELEVANCY_THRESHOLD, model=JUDGE_MODEL, verbose_mode=True),
    ])


@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_synthesis_hallucination(scenario: str, plan: dict) -> None:
    """primaryRisk must not invent risks beyond what riskAnalysis.warnings states."""
    synthesis = plan.get("synthesis")
    if synthesis is None:
        pytest.skip(f"{scenario}: synthesis absent")

    test_case = LLMTestCase(
        input="Describe the primary risk",
        actual_output=synthesis["primaryRisk"],
        context=build_retrieval_context(plan),
    )
    assert_test(test_case, [
        HallucinationMetric(threshold=HALLUCINATION_THRESHOLD, model=JUDGE_MODEL, verbose_mode=True),
    ])


@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_synthesis_ticker_grounding(scenario: str, plan: dict) -> None:
    """Narratives must reference real tickers from the allocation (not generic placeholders).

    This test is deterministic — no LLM judge needed.
    """
    synthesis = plan.get("synthesis")
    if synthesis is None:
        pytest.skip(f"{scenario}: synthesis absent")

    alloc = plan.get("portfolio", {}).get("allocation", [])
    tickers = [s["ticker"] for s in alloc]
    narrative = synthesis["portfolioNarrative"] + " " + " ".join(synthesis.get("keyInsights", []))

    mentioned = sum(1 for t in tickers if t in narrative)
    ratio = mentioned / max(len(tickers), 1)
    assert ratio >= TICKER_MENTION_THRESHOLD, (
        f"[{scenario}] Only {mentioned}/{len(tickers)} tickers mentioned in narrative "
        f"({ratio:.0%} < {TICKER_MENTION_THRESHOLD:.0%}). Tickers: {tickers}"
    )


@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_synthesis_actionability(scenario: str, plan: dict) -> None:
    """actionableNextSteps must start with a verb and contain specific details."""
    synthesis = plan.get("synthesis")
    if synthesis is None:
        pytest.skip(f"{scenario}: synthesis absent")

    steps = synthesis.get("actionableNextSteps", [])
    assert len(steps) == 3, f"[{scenario}] Expected 3 actionableNextSteps, got {len(steps)}"

    test_case = LLMTestCase(
        input="Provide 3 actionable next steps to implement the portfolio",
        actual_output="\n".join(f"{i+1}. {s}" for i, s in enumerate(steps)),
        retrieval_context=build_retrieval_context(plan),
    )
    assert_test(test_case, [
        GEval(
            name="Actionability",
            criteria=(
                "Each step should start with an action verb and reference a specific "
                "ticker symbol, account type, or concrete financial action. Generic advice "
                "like 'consult a financial advisor' or 'do your research' should score low."
            ),
            evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
            threshold=0.7,
            model=JUDGE_MODEL,
            verbose_mode=True,
        ),
    ])


# ── IPS tests ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_ips_faithfulness(scenario: str, plan: dict) -> None:
    """IPS executive summary must only reference facts from the V3Plan."""
    ips = plan.get("ips")
    if ips is None:
        pytest.skip(f"{scenario}: IPS absent")

    test_case = LLMTestCase(
        input="Write IPS executive summary",
        actual_output=ips.get("executiveSummary", ""),
        retrieval_context=build_retrieval_context(plan),
    )
    assert_test(test_case, [
        FaithfulnessMetric(threshold=FAITHFULNESS_THRESHOLD, model=JUDGE_MODEL, verbose_mode=True),
    ])


@pytest.mark.parametrize("scenario,plan", load_fixtures())
def test_ips_rebalancing_consistency(scenario: str, plan: dict) -> None:
    """IPS rebalancing policy should be consistent with the time horizon."""
    ips = plan.get("ips")
    if ips is None:
        pytest.skip(f"{scenario}: IPS absent")

    horizon = plan.get("clientProfile", {}).get("timeHorizon", {}).get("yearsToGoal", 10)
    rebalancing = ips.get("constraints", {}).get("rebalancingPolicy", "")

    test_case = LLMTestCase(
        input=f"Rebalancing policy for {horizon}-year horizon",
        actual_output=rebalancing,
        retrieval_context=[f"Time horizon: {horizon} years"],
    )
    assert_test(test_case, [
        AnswerRelevancyMetric(threshold=RELEVANCY_THRESHOLD, model=JUDGE_MODEL, verbose_mode=True),
    ])
