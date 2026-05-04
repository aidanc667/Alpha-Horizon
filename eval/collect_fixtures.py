#!/usr/bin/env python3
"""
Collect V3Plan fixtures by calling the running dev server.

Usage:
  1. Start the dev server: npm run dev
  2. Get a session token from the browser Console on localhost:3000:
       const token = await window.Clerk.session.getToken(); console.log(token);
  3. Export immediately (token expires in 5 minutes):
       export CLERK_SESSION_TOKEN=<paste token here>
  4. Run right away: python3 eval/collect_fixtures.py

Saves one JSON file per scenario to eval/fixtures/.
"""

import json
import os
import sys
import requests

API_URL = os.getenv("API_URL", "http://localhost:3000/api/portfolio-agent")
SESSION_TOKEN = os.getenv("CLERK_SESSION_TOKEN", "")

SCENARIOS: list[dict] = [
    {
        "name": "conservative_near_retirement",
        "answers": {
            "goal": "financial_independence",
            "goalAmount": 1_000_000,
            "timeHorizon": 4,
            "startingCapital": 400_001,  # +1 to bust Neon plan cache
            "monthlyContribution": 2_000,
            "financialSnapshot": {"hasEmergencyFund": True, "hasHighInterestDebt": False},
            "filingStatus": "married_filing_jointly",
            "annualIncome": 180_000,
            "state": "CA",
            "age": 61,
            "existingAccounts": {"traditional": 250_000, "roth": 50_000, "hsa": 0},
            "riskCapacity": "low",
            "riskWillingness": "low",
            "incomeStability": 4,
            "availableAccounts": ["Taxable Brokerage", "Traditional 401(k)", "Roth IRA"],
        },
    },
    {
        "name": "aggressive_growth_long_horizon",
        "answers": {
            "goal": "max_growth",
            "timeHorizon": 30,
            "startingCapital": 50_001,  # +1 to bust Neon plan cache
            "monthlyContribution": 1_500,
            "financialSnapshot": {"hasEmergencyFund": True, "hasHighInterestDebt": False},
            "filingStatus": "single",
            "annualIncome": 120_000,
            "state": "TX",
            "age": 28,
            "existingAccounts": {"traditional": 0, "roth": 10_000, "hsa": 0},
            "riskCapacity": "high",
            "riskWillingness": "high",
            "incomeStability": 4,
            "availableAccounts": ["Taxable Brokerage", "Roth IRA"],
        },
    },
    {
        "name": "high_bracket_taxable",
        "answers": {
            "goal": "financial_independence",
            "goalAmount": 5_000_000,
            "timeHorizon": 18,
            "startingCapital": 800_001,  # +1 to bust Neon plan cache
            "monthlyContribution": 8_000,
            "financialSnapshot": {"hasEmergencyFund": True, "hasHighInterestDebt": False},
            "filingStatus": "married_filing_jointly",
            "annualIncome": 650_000,
            "state": "NY",
            "age": 45,
            "existingAccounts": {"traditional": 300_000, "roth": 0, "hsa": 5_000},
            "riskCapacity": "high",
            "riskWillingness": "medium",
            "incomeStability": 5,
            "availableAccounts": ["Taxable Brokerage", "Traditional 401(k)", "HSA"],
        },
    },
    {
        "name": "no_emergency_fund_medium_risk",
        "answers": {
            "goal": "major_purchase",
            "goalAmount": 200_000,
            "timeHorizon": 7,
            "startingCapital": 30_001,  # +1 to bust Neon plan cache
            "monthlyContribution": 1_000,
            "financialSnapshot": {"hasEmergencyFund": False, "hasHighInterestDebt": False},
            "filingStatus": "single",
            "annualIncome": 85_000,
            "state": "WA",
            "age": 32,
            "existingAccounts": {"traditional": 0, "roth": 5_000, "hsa": 0},
            "riskCapacity": "medium",
            "riskWillingness": "medium",
            "incomeStability": 3,
            "availableAccounts": ["Taxable Brokerage", "Roth IRA"],
        },
    },
    # drawdown_phase (timeHorizon: 0) intentionally hits a hardStop in agent1
    # ("Client is in drawdown phase") and never produces a plan. Excluded from
    # fixture collection; covered separately via unit tests if needed.
]


def collect(scenario: dict) -> None:
    name = scenario["name"]
    out_path = f"eval/fixtures/{name}.json"

    if os.path.exists(out_path):
        print(f"  [skip] {name} already exists")
        return

    headers = {"Content-Type": "application/json"}
    if SESSION_TOKEN:
        headers["Authorization"] = f"Bearer {SESSION_TOKEN}"

    print(f"  [fetch] {name}...")
    resp = requests.post(API_URL, json={"answers": scenario["answers"]}, headers=headers, stream=True)

    if resp.status_code != 200:
        print(f"  [error] {name}: HTTP {resp.status_code} — {resp.text[:200]}")
        return

    plan = None
    pipeline_error = None
    for line in resp.iter_lines():
        if not line:
            continue
        try:
            event = json.loads(line)
            if event.get("type") == "plan":
                plan = event["plan"]
            elif event.get("type") == "error":
                pipeline_error = event.get("error", "unknown pipeline error")
        except json.JSONDecodeError:
            # Non-JSON line means the response is probably HTML (expired auth token)
            if b"<!DOCTYPE" in line or b"<html" in line:
                print(f"  [error] {name}: auth token expired — got HTML redirect to sign-in")
                return
            continue

    if plan is None:
        if pipeline_error:
            print(f"  [skip] {name}: pipeline blocked — {pipeline_error}")
        else:
            print(f"  [error] {name}: no plan in response (check token expiry)")
        return

    # Add scenario metadata for traceability
    plan["_fixture_scenario"] = name
    plan["_fixture_intake"] = scenario["answers"]

    with open(out_path, "w") as f:
        json.dump(plan, f, indent=2)
    print(f"  [saved] {out_path}")


if __name__ == "__main__":
    if not SESSION_TOKEN:
        print("Warning: CLERK_SESSION_TOKEN not set — API calls may return 401.")
        print("Set it by logging in and copying the __session cookie from DevTools.\n")

    os.makedirs("eval/fixtures", exist_ok=True)
    print("Collecting fixtures...")
    for scenario in SCENARIOS:
        collect(scenario)
    print("Done.")
