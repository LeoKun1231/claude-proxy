export interface TokenUsagePayload {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface TokenUsageRecord {
    requestId: string;
    providerId: string;
    providerLabel: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    timestamp: string;
    timestampMs: number;
}
