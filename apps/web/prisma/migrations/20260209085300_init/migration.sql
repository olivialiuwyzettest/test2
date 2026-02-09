-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "configJson" JSONB NOT NULL,
    "combosTotal" INTEGER NOT NULL DEFAULT 0,
    "combosSkippedSchedule" INTEGER NOT NULL DEFAULT 0,
    "queriesNonstop" INTEGER NOT NULL DEFAULT 0,
    "queriesOneStop" INTEGER NOT NULL DEFAULT 0,
    "offersFound" INTEGER NOT NULL DEFAULT 0,
    "offersUpserted" INTEGER NOT NULL DEFAULT 0,
    "offersUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" JSONB
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "providerOfferId" TEXT,
    "offerKey" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departDate" TEXT NOT NULL,
    "returnDate" TEXT NOT NULL,
    "cabin" TEXT NOT NULL,
    "stopsTotal" INTEGER NOT NULL,
    "stopsCategory" TEXT NOT NULL,
    "overnightLayover" BOOLEAN NOT NULL DEFAULT false,
    "segmentsJson" JSONB NOT NULL,
    "totalDurationOutboundMinutes" INTEGER,
    "totalDurationInboundMinutes" INTEGER,
    "totalTripMinutes" INTEGER,
    "currency" TEXT NOT NULL,
    "priceTotalCents" INTEGER NOT NULL,
    "groupAdults" INTEGER NOT NULL,
    "groupChildren" INTEGER NOT NULL,
    "pricePerAdultCents" INTEGER,
    "pricePerChildCents" INTEGER,
    "deepLink" TEXT,
    "rawPayload" JSONB,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dealScore" INTEGER,
    "isGreatDeal" BOOLEAN NOT NULL DEFAULT false,
    "dealRationale" JSONB,
    "pricePercentile" REAL,
    "comparableMedianPriceCents" INTEGER,
    "priceDrop7dPct" REAL,
    "durationVsMedianMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL,
    "priceTotalCents" INTEGER NOT NULL,
    "rawPrice" JSONB,
    CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceHistory_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderQuotaDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ScanRun_provider_startedAt_idx" ON "ScanRun"("provider", "startedAt");

-- CreateIndex
CREATE INDEX "ScanRun_status_startedAt_idx" ON "ScanRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "Offer_origin_destination_departDate_returnDate_idx" ON "Offer"("origin", "destination", "departDate", "returnDate");

-- CreateIndex
CREATE INDEX "Offer_isGreatDeal_dealScore_idx" ON "Offer"("isGreatDeal", "dealScore");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_provider_offerKey_key" ON "Offer"("provider", "offerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_provider_providerOfferId_key" ON "Offer"("provider", "providerOfferId");

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_capturedAt_idx" ON "PriceHistory"("offerId", "capturedAt");

-- CreateIndex
CREATE INDEX "PriceHistory_scanRunId_capturedAt_idx" ON "PriceHistory"("scanRunId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProviderQuotaDay_day_provider_idx" ON "ProviderQuotaDay"("day", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderQuotaDay_provider_day_key" ON "ProviderQuotaDay"("provider", "day");
