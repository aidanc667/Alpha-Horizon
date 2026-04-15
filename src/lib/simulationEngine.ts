import { SimulationInput, SimulationResult } from '@/types';

interface DailyPrice { date: string; close: number; }

export async function runSimulation(input: SimulationInput): Promise<SimulationResult> {
  const tickers = input.allocations.map(a => a.ticker);
  const switchDate = '2010-09-07';
  const useModern = input.startDate >= switchDate;
  const benchmarks = useModern ? ['VOO', 'BND'] : ['VFINX', 'VBMFX'];
  const allTickers = Array.from(new Set([...tickers, ...benchmarks]));

  const dataMap: Record<string, DailyPrice[]> = {};
  const warnings: string[] = [];

  // Fetch all data from /api/history (server proxy — no CORS, no key exposure)
  await Promise.all(allTickers.map(async (t) => {
    try {
      const res = await fetch(`/api/history?ticker=${t}&from=${input.startDate}&to=${input.endDate}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      dataMap[t] = json.data;
    } catch (e: any) {
      warnings.push(`Could not fetch data for ${t}: ${e.message}`);
    }
  }));

  const firstWithData = tickers.find(t => dataMap[t]?.length > 0);
  const dates = firstWithData ? dataMap[firstWithData].map(d => d.date) : [];
  if (!dates.length) throw new Error(warnings.join('. ') || 'No data found for selected period.');

  // Build lookup maps
  const maps: Record<string, Map<string, number>> = {};
  allTickers.forEach(t => { maps[t] = new Map(dataMap[t]?.map(d => [d.date, d.close]) || []); });

  const validDates = dates
    .filter(d => tickers.every(t => maps[t].has(d)) && benchmarks.every(t => maps[t].has(d)))
    .sort();

  if (!validDates.length) throw new Error('No overlapping data found for all tickers in this period.');
  if (validDates[0] > input.startDate) {
    warnings.push(`Simulation started on ${new Date(validDates[0]).toLocaleDateString()} (earliest data available for all tickers).`);
  }

  // ─── Simulation loop ────────────────────────────────────────────────────────
  let pValue = input.initialInvestment;
  let bValue = input.initialInvestment;
  let totalContrib = input.initialInvestment;

  let tickerVals = input.allocations.reduce((acc, a) => {
    acc[a.ticker] = (a.percentage / 100) * input.initialInvestment;
    return acc;
  }, {} as Record<string, number>);

  let benchVals: Record<string, number> = {
    [benchmarks[0]]: 0.6 * input.initialInvestment,
    [benchmarks[1]]: 0.4 * input.initialInvestment,
  };

  const dailyResults: SimulationResult['dailyData'] = [];
  const audit: SimulationResult['audit'] = [{ date: validDates[0], amount: input.initialInvestment, type: 'Initial' }];

  const getP = (t: string, d: string) => maps[t].get(d) || 0;
  let lastMonth = new Date(validDates[0]).getUTCMonth();
  let lastYear  = new Date(validDates[0]).getUTCFullYear();

  let cumTWR = 1, cumBTWR = 1;
  const yearlyTWRs: Record<number, number[]> = {};
  const yearlyBTWRs: Record<number, number[]> = {};
  const pReturns: number[] = [], bReturns: number[] = [];
  const perTickerReturns: Record<string, number[]> = {};
  tickers.forEach(t => { perTickerReturns[t] = []; });

  for (let i = 0; i < validDates.length; i++) {
    const date  = validDates[i];
    const dObj  = new Date(date);
    const month = dObj.getUTCMonth();
    const year  = dObj.getUTCFullYear();

    if (i > 0) {
      const prev = validDates[i - 1];
      let newP = 0;
      tickers.forEach(t => {
        const ret = getP(t, prev) ? getP(t, date) / getP(t, prev) : 1;
        tickerVals[t] *= ret;
        newP += tickerVals[t];
      });
      let newB = 0;
      benchmarks.forEach(t => {
        const ret = getP(t, prev) ? getP(t, date) / getP(t, prev) : 1;
        benchVals[t] *= ret;
        newB += benchVals[t];
      });

      const dTWR = pValue > 0 ? newP / pValue : 1;
      const dBTWR = bValue > 0 ? newB / bValue : 1;
      cumTWR  *= dTWR;
      cumBTWR *= dBTWR;
      pReturns.push(dTWR - 1);
      bReturns.push(dBTWR - 1);
      tickers.forEach(t => {
        perTickerReturns[t].push(getP(t, prev) ? getP(t, date) / getP(t, prev) - 1 : 0);
      });

      if (!yearlyTWRs[year])  yearlyTWRs[year]  = [];
      if (!yearlyBTWRs[year]) yearlyBTWRs[year] = [];
      yearlyTWRs[year].push(dTWR);
      yearlyBTWRs[year].push(dBTWR);

      pValue = newP;
      bValue = newB;
    }

    if (month !== lastMonth) {
      const c = input.monthlyContribution;
      totalContrib += c;
      input.allocations.forEach(a => { tickerVals[a.ticker] += (a.percentage / 100) * c; });
      benchVals[benchmarks[0]] += 0.6 * c;
      benchVals[benchmarks[1]] += 0.4 * c;
      pValue += c; bValue += c;
      audit.push({ date, amount: c, type: 'Monthly' });
      lastMonth = month;
    }

    if (input.annualRebalance && year !== lastYear) {
      input.allocations.forEach(a => { tickerVals[a.ticker] = (a.percentage / 100) * pValue; });
      benchVals[benchmarks[0]] = 0.6 * bValue;
      benchVals[benchmarks[1]] = 0.4 * bValue;
      lastYear = year;
    }

    dailyResults.push({ date, portfolioValue: pValue, benchmarkValue: bValue, totalContributed: totalContrib });
  }

  // ─── Metrics ────────────────────────────────────────────────────────────────
  const first = new Date(validDates[0]), last = new Date(validDates[validDates.length - 1]);
  const years = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

  const cagr  = years > 0 ? (Math.pow(cumTWR,  1 / years) - 1) * 100 : 0;
  const bCagr = years > 0 ? (Math.pow(cumBTWR, 1 / years) - 1) * 100 : 0;

  const mean  = pReturns.reduce((a, b) => a + b, 0) / pReturns.length;
  const bMean = bReturns.reduce((a, b) => a + b, 0) / bReturns.length;
  const vol  = Math.sqrt(pReturns.reduce((a, b) => a + Math.pow(b - mean,  2), 0) / pReturns.length) * Math.sqrt(252) * 100;
  const bVol = Math.sqrt(bReturns.reduce((a, b) => a + Math.pow(b - bMean, 2), 0) / bReturns.length) * Math.sqrt(252) * 100;

  const rf = 0.02;
  const sharpe  = (cagr  / 100 - rf) / (vol  / 100 || 1);
  const bSharpe = (bCagr / 100 - rf) / (bVol / 100 || 1);

  // Sortino Ratio: uses downside deviation (returns below risk-free rate) instead of total volatility
  const rfDaily = rf / 252;
  const downsideDev = Math.sqrt(
    pReturns.reduce((a, r) => a + Math.pow(Math.min(r - rfDaily, 0), 2), 0) / pReturns.length
  ) * Math.sqrt(252) * 100;
  const sortino = downsideDev > 0 ? (cagr / 100 - rf) / (downsideDev / 100) : 0;

  let cov = 0;
  for (let i = 0; i < pReturns.length; i++) cov += (pReturns[i] - mean) * (bReturns[i] - bMean);
  cov /= pReturns.length;
  const bVar = bReturns.reduce((a, b) => a + Math.pow(b - bMean, 2), 0) / bReturns.length;
  const beta  = bVar > 0 ? cov / bVar : 1;
  const alpha = (cagr / 100) - (rf + beta * (bCagr / 100 - rf));
  const activeRets = pReturns.map((r, i) => r - bReturns[i]);
  const aMean = activeRets.reduce((a, b) => a + b, 0) / activeRets.length;
  const te = Math.sqrt(activeRets.reduce((a, b) => a + Math.pow(b - aMean, 2), 0) / activeRets.length) * Math.sqrt(252) * 100;
  // Information Ratio: active return (CAGR - benchmark CAGR) divided by tracking error
  const informationRatio = te > 0 ? (cagr - bCagr) / te : 0;

  let maxDD = 0, bMaxDD = 0, peak = -Infinity, bPeak = -Infinity, cTWR = 1, cBTWR = 1;
  const allTWRs  = Object.values(yearlyTWRs).flat();
  const allBTWRs = Object.values(yearlyBTWRs).flat();
  for (let i = 0; i < allTWRs.length; i++) {
    cTWR *= allTWRs[i];
    if (cTWR > peak) peak = cTWR;
    const dd = (cTWR - peak) / peak;
    if (dd < maxDD) maxDD = dd;
    if (allBTWRs[i]) {
      cBTWR *= allBTWRs[i];
      if (cBTWR > bPeak) bPeak = cBTWR;
      const bdd = (cBTWR - bPeak) / bPeak;
      if (bdd < bMaxDD) bMaxDD = bdd;
    }
  }

  let maxDDContrib = 0;
  dailyResults.forEach(d => {
    const dd = (d.portfolioValue - d.totalContributed) / d.totalContributed;
    if (dd < maxDDContrib) maxDDContrib = dd;
  });

  // Max drawdown duration (trading days below previous peak)
  let ddPeak = dailyResults[0]?.portfolioValue ?? 0;
  let ddStartIdx = 0;
  let maxDrawdownDuration = 0;
  for (let i = 1; i < dailyResults.length; i++) {
    if (dailyResults[i].portfolioValue >= ddPeak) {
      ddPeak = dailyResults[i].portfolioValue;
      ddStartIdx = i;
    } else {
      const dur = i - ddStartIdx;
      if (dur > maxDrawdownDuration) maxDrawdownDuration = dur;
    }
  }

  const calmarRatio = maxDD !== 0 ? cagr / (Math.abs(maxDD) * 100) : 0;

  const yearsList = Array.from(new Set(validDates.map(d => new Date(d).getUTCFullYear())));
  const yearEndSummary = yearsList.map(y => {
    const yd = dailyResults.filter(d => new Date(d.date).getUTCFullYear() === y);
    const last = yd[yd.length - 1];
    const rets = yearlyTWRs[y] || [];
    const bRets = yearlyBTWRs[y] || [];
    return { year: y, endValue: last.portfolioValue, totalContributed: last.totalContributed, annualReturn: (rets.reduce((a, b) => a * b, 1) - 1) * 100, benchmarkAnnualReturn: (bRets.reduce((a, b) => a * b, 1) - 1) * 100 };
  });

  const twrReturns = Object.entries(yearlyTWRs).map(([yr, rets]) => ({ year: parseInt(yr), return: (rets.reduce((a, b) => a * b, 1) - 1) * 100 }));

  return {
    dailyData: dailyResults,
    yearEndSummary,
    metrics: {
      endingValue: pValue,
      totalContributed: totalContrib,
      netProfit: pValue - totalContrib,
      totalReturnPct: (pValue / totalContrib - 1) * 100,
      cagr, volatility: vol, sharpeRatio: sharpe, sortinoRatio: sortino, informationRatio,
      maxDrawdown: Math.abs(maxDD) * 100,
      maxDrawdownFromContributions: Math.abs(maxDDContrib) * 100,
      alpha: alpha * 100, beta, trackingError: te,
      benchmarkCagr: bCagr, benchmarkVolatility: bVol,
      benchmarkSharpeRatio: bSharpe, benchmarkMaxDrawdown: Math.abs(bMaxDD) * 100,
      calmarRatio, maxDrawdownDuration, cumulativeTwr: cumTWR,
    },
    twrReturns, audit, dailyPortfolioReturns: pReturns, perTickerDailyReturns: perTickerReturns, warnings,
  };
}
