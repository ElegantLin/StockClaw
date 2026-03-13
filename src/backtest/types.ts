import type { PortfolioSnapshot, Position, SpecialistResult, ToolCallRecord, UsageAggregate } from "../types.js";

export type BacktestEntryKind = "asset" | "portfolio" | "current_portfolio";

export type BacktestRunStatus = "prepared" | "running" | "completed" | "failed";
export type BacktestJobStatus = "queued" | "preparing" | "running" | "completed" | "failed";

export interface BacktestExecutionPolicy {
  buyPrice: "open";
  sellPrice: "close";
  feesBps: number;
  slippageBps: number;
  spawnSpecialists: boolean;
  maxLookbackBars: number;
}

export interface BacktestHistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
  rawTime: string | null;
}

export interface BacktestProviderInfo {
  server: string;
  historyTool: string;
  tradeDatesTool: string | null;
  frequency: string;
  adjustFlag: string;
  format: string;
  selectedAt: string;
  sourceSummary?: string;
  toolchain?: string[];
}

export interface BacktestPositionInput {
  symbol: string;
  quantity: number;
  avgCost?: number;
  marketPrice?: number | null;
  marketValue?: number | null;
  currency?: string;
}

export interface BacktestDataset {
  datasetId: string;
  runId: string;
  kind: BacktestEntryKind;
  preparedBySessionId: string;
  parentSessionId: string;
  rootUserMessage: string;
  dateFrom: string;
  dateTo: string;
  symbols: string[];
  provider: BacktestProviderInfo;
  executionPolicy: BacktestExecutionPolicy;
  initialPortfolio: PortfolioSnapshot;
  barsBySymbol: Record<string, BacktestHistoricalBar[]>;
  calendar: string[];
  warnings: string[];
  preparedAt: string;
}

export interface BacktestWindow {
  currentDate: string;
  priorDate: string | null;
  lookbackBars: number;
  barsBySymbol: Record<string, BacktestHistoricalBar[]>;
}

export interface BacktestContextRequest {
  contextType: string;
  objective: string;
  symbols: string[];
  lookbackDays: number;
  maxItems: number;
}

export interface BacktestContextSnapshot {
  cacheKey: string;
  date: string;
  request: BacktestContextRequest;
  asOf: string;
  symbols: string[];
  providerType: string;
  providerName: string;
  toolName: string;
  title: string;
  summary: string;
  findings: string[];
  rawEvidence: string[];
  payloadJson: string | null;
  warnings: string[];
  resolutionSessionId: string;
  resolutionMessage: string;
  resolutionToolCalls: ToolCallRecord[];
  createdAt: string;
}

export interface BacktestFillRecord {
  date: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  requestedPrice: number;
  filledPrice: number;
  grossAmount: number;
  fees: number;
  slippage: number;
  netCashImpact: number;
  rationale: string;
  status: "filled" | "rejected";
  reason: string | null;
  requestedBySessionId: string;
  createdAt: string;
}

export interface BacktestDecisionSession {
  date: string;
  sessionId: string;
  requestId: string;
  rootMessage: string;
  toolCalls: ToolCallRecord[];
  specialists: SpecialistResult[];
  usage?: UsageAggregate;
  createdAt: string;
}

export interface BacktestEquityPoint {
  date: string;
  cash: number;
  equity: number;
}

export interface BacktestRunSummary {
  runId: string;
  datasetId: string;
  parentSessionId: string;
  status: BacktestRunStatus;
  kind: BacktestEntryKind;
  symbols: string[];
  dateFrom: string;
  dateTo: string;
  provider: BacktestProviderInfo;
  preparedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  reportSummary: string | null;
}

export interface BacktestReport {
  runId: string;
  datasetId: string;
  parentSessionId: string;
  kind: BacktestEntryKind;
  symbols: string[];
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  tradingDays: number;
  filledOrders: number;
  rejectedOrders: number;
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  equityCurve: BacktestEquityPoint[];
  endingPortfolio: PortfolioSnapshot;
  filledTrades: BacktestFillRecord[];
  rejectedTrades: BacktestFillRecord[];
  summary: string;
  warnings: string[];
}

export interface BacktestRun {
  runId: string;
  datasetId: string;
  parentSessionId: string;
  status: BacktestRunStatus;
  kind: BacktestEntryKind;
  dataset: BacktestDataset;
  decisionSessions: BacktestDecisionSession[];
  contextSnapshots: BacktestContextSnapshot[];
  fills: BacktestFillRecord[];
  portfolioSnapshots: PortfolioSnapshot[];
  report: BacktestReport | null;
  error: string | null;
  preparedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BacktestAssetInput {
  symbol: string;
  dateFrom: string;
  dateTo: string;
  initialCash: number;
  feesBps?: number;
  slippageBps?: number;
  spawnSpecialists?: boolean;
}

export interface BacktestPortfolioInput {
  dateFrom: string;
  dateTo: string;
  cash: number;
  positions: BacktestPositionInput[];
  feesBps?: number;
  slippageBps?: number;
  spawnSpecialists?: boolean;
}

export interface BacktestPrepareResult {
  runId: string;
  datasetId: string;
  kind: BacktestEntryKind;
  parentSessionId: string;
  symbols: string[];
  provider: BacktestProviderInfo;
  tradingDays: number;
  calendar: string[];
  warnings: string[];
}

export interface BacktestRunResult {
  runId: string;
  datasetId: string;
  parentSessionId: string;
  status: "completed" | "failed";
  report: BacktestReport;
  error: string | null;
}

export interface BacktestAssetJobInput extends BacktestAssetInput {
  kind: "asset";
}

export interface BacktestPortfolioJobInput extends BacktestPortfolioInput {
  kind: "portfolio";
}

export interface BacktestCurrentPortfolioJobInput {
  kind: "current_portfolio";
  dateFrom: string;
  dateTo: string;
  feesBps?: number;
  slippageBps?: number;
  spawnSpecialists?: boolean;
  initialPortfolioSnapshot?: PortfolioSnapshot;
}

export type BacktestJobInput =
  | BacktestAssetJobInput
  | BacktestPortfolioJobInput
  | BacktestCurrentPortfolioJobInput;

export interface BacktestJobSummary {
  jobId: string;
  parentSessionId: string;
  status: BacktestJobStatus;
  kind: BacktestEntryKind;
  symbols: string[];
  dateFrom: string;
  dateTo: string;
  runId: string | null;
  datasetId: string | null;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionAppendedAt: string | null;
  channelDeliveredAt: string | null;
  deliveredAt: string | null;
  nextDeliveryAttemptAt: string | null;
  deliveryAttemptCount: number;
  deliveryError: string | null;
  tracePath: string | null;
  reportPath: string | null;
  reportSummary: string | null;
  error: string | null;
}

export interface BacktestJob {
  jobId: string;
  parentSessionId: string;
  parentUserId: string;
  parentChannel: "web" | "telegram";
  requestId: string | null;
  status: BacktestJobStatus;
  input: BacktestJobInput;
  rootUserMessage: string;
  symbols: string[];
  runId: string | null;
  datasetId: string | null;
  warnings: string[];
  report: BacktestReport | null;
  error: string | null;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionAppendedAt: string | null;
  channelDeliveredAt: string | null;
  deliveredAt: string | null;
  nextDeliveryAttemptAt: string | null;
  deliveryAttemptCount: number;
  deliveryError: string | null;
  tracePath: string | null;
  reportPath: string | null;
}

export interface BacktestTraceEvent {
  timestamp: string;
  jobId: string | null;
  runId: string | null;
  level: "info" | "warn" | "error";
  type: string;
  data: Record<string, unknown>;
}

export interface BacktestJobSubmissionResult {
  jobId: string;
  parentSessionId: string;
  status: "queued";
  kind: BacktestEntryKind;
  symbols: string[];
  dateFrom: string;
  dateTo: string;
  submittedAt: string;
  note: string;
}

export interface BacktestJobCounts {
  queued: number;
  preparing: number;
  running: number;
  completed: number;
  failed: number;
  active: number;
}

export interface BacktestSessionJobsSnapshot {
  counts: BacktestJobCounts;
  jobs: BacktestJobSummary[];
}

export interface BacktestTradeIntent {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  rationale: string;
}

export interface BacktestTradeExecutionResult {
  status: "filled" | "rejected";
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  message: string;
}

export interface BacktestSubagentResult extends SpecialistResult {
  date: string;
}

export type BacktestPositionMap = Record<string, Position>;
