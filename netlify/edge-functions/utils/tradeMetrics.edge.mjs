/**
 * Format trade time from seconds into a readable string format.
 * 
 * @param {number} seconds - Trade time in seconds
 * @returns {string} Formatted trade time
 */
export function formatTradeTime(seconds) {
  const days = Math.floor(seconds / 86400);
  const remainder = seconds % 86400;
  const hours = Math.floor(remainder / 3600);
  const minutes = Math.floor((remainder % 3600) / 60);
  
  if (days > 0) {
    return `${days.toString().padStart(2, '0')}:${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } else {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}

/**
 * Calculate trade metrics based on input parameters.
 * 
 * @param {Object} params - Trade parameters
 * @param {string} params.symbol - Trading symbol (e.g., "BTCUSDT")
 * @param {string} params.side - Trade side (e.g., "Buy" or "Sell")
 * @param {number} params.plannedEntry - The intended entry price
 * @param {number} params.actualEntry - The actual executed entry price
 * @param {number} params.takeProfit - The target take profit price
 * @param {number} params.stopLoss - The stop loss price
 * @param {number} params.maxRisk - The maximum dollar risk
 * @param {number} params.finishedDollar - The final PnL in dollars
 * @param {number} params.openFee - Fee incurred when opening the trade
 * @param {number} params.closeFee - Fee incurred when closing the trade
 * @param {number} params.openTime - Trade open timestamp in milliseconds
 * @param {number} params.closeTime - Trade close timestamp in milliseconds
 * @returns {Object} - Object containing calculated metrics
 */
export function calculateTradeMetrics({
  symbol,
  side,
  plannedEntry,
  actualEntry,
  takeProfit,
  stopLoss,
  maxRisk,
  finishedDollar,
  openFee,
  closeFee,
  openTime,
  closeTime,
}) {
  console.log('Calculating trade metrics with params:', {
    symbol,
    side,
    plannedEntry,
    actualEntry,
    takeProfit,
    stopLoss,
    maxRisk,
    finishedDollar,
    openFee,
    closeFee,
    openTime,
    closeTime
  });

  // Normalize side to uppercase and trim
  const sideUpper = side.toUpperCase().trim();
  
  // Calculate risk per unit based on side
  let riskPerUnit = 0;
  if (sideUpper.startsWith("B")) {
    // For long trades: planned entry - stop loss
    riskPerUnit = plannedEntry - stopLoss;
  } else if (sideUpper.startsWith("S")) {
    // For short trades: stop loss - planned entry
    riskPerUnit = stopLoss - plannedEntry;
  }
  
  // Calculate position units (quantity)
  const positionUnits = riskPerUnit !== 0 ? maxRisk / riskPerUnit : 0;
  
  // Calculate position notional value at planned entry
  const positionNotional = plannedEntry * positionUnits;
  
  // Calculate target risk/reward ratio
  let targetRR = 0;
  if (riskPerUnit !== 0) {
    if (sideUpper.startsWith("B")) {
      targetRR = (takeProfit - plannedEntry) / riskPerUnit;
    } else if (sideUpper.startsWith("S")) {
      targetRR = (plannedEntry - takeProfit) / riskPerUnit;
    }
  }
  
  // Calculate finished risk/reward ratio
  const finishedRR = maxRisk !== 0 ? finishedDollar / maxRisk : 0;
  
  // Calculate deviation from max risk (if trade lost more than max risk)
  let deviationPercent = 0;
  if (finishedDollar < 0 && maxRisk > 0) {
    const actualLoss = Math.abs(finishedDollar);
    deviationPercent = ((actualLoss - maxRisk) / maxRisk) * 100;
  }
  
  // Calculate slippage (absolute difference between actual and planned entry)
  const slippage = Math.abs(actualEntry - plannedEntry);
  
  // Calculate trade time
  const totalTradeTimeSeconds = Math.floor((closeTime - openTime) / 1000);
  const formattedTradeTime = formatTradeTime(totalTradeTimeSeconds);
  
  // Calculate total fees
  const totalFees = openFee + closeFee;
  
  console.log('Calculated trade metrics:', {
    riskPerUnit,
    positionUnits,
    targetRR,
    finishedRR,
    deviationPercent,
    totalTradeTimeSeconds,
    formattedTradeTime
  });
  
  // Return calculated metrics
  return {
    symbol,
    side,
    wantedEntry: plannedEntry,
    stopLoss,
    takeProfit,
    maxRisk,
    riskPerUnit,
    positionUnits,
    positionNotional,
    targetRR,
    finishedRR,
    deviationPercentFromMaxRisk: deviationPercent,
    slippage,
    totalTradeTimeSeconds,
    formattedTradeTime,
    totalFees,
  };
}
