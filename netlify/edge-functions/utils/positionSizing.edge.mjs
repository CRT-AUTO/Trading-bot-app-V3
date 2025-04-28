// Position sizing utility functions for edge functions

/**
 * Calculates the appropriate position size based on risk parameters and price data.
 * 
 * @param {Object} params - Position sizing parameters
 * @param {number} params.entryPrice - Entry price for the trade
 * @param {number} params.stopLoss - Stop loss level for the trade
 * @param {number} params.riskAmount - Amount to risk in base currency (USDT)
 * @param {string} params.side - Trade direction ('Buy' or 'Sell')
 * @param {number} params.feePercentage - Trading fee percentage as a decimal (e.g., 0.075 for 0.075%)
 * @param {number} params.minQty - Minimum order quantity allowed by the exchange
 * @param {number} params.qtyStep - Quantity step size allowed by the exchange
 * @param {number} params.maxPositionSize - Maximum position size allowed (optional)
 * @param {number} params.decimals - Number of decimal places to round quantity to
 * 
 * @returns {number} - Calculated position size
 */
export function calculatePositionSize({
  entryPrice,
  stopLoss,
  riskAmount,
  side,
  feePercentage,
  minQty,
  qtyStep,
  maxPositionSize = 0,
  decimals = 8
}) {
  // Input validation
  if (!entryPrice || entryPrice <= 0) {
    throw new Error('Entry price must be a positive number');
  }
  if (!stopLoss || stopLoss <= 0) {
    throw new Error('Stop loss must be a positive number');
  }
  if (!riskAmount || riskAmount <= 0) {
    throw new Error('Risk amount must be a positive number');
  }
  if (side !== 'Buy' && side !== 'Sell') {
    throw new Error('Side must be "Buy" or "Sell"');
  }
  
  console.log(`Calculating position size with params: entryPrice=${entryPrice}, stopLoss=${stopLoss}, riskAmount=${riskAmount}, side=${side}, feePercentage=${feePercentage}, minQty=${minQty}, qtyStep=${qtyStep}, maxPositionSize=${maxPositionSize}`);

  // Calculate risk per unit (absolute difference)
  let riskPerUnit;
  if (side === 'Buy') {
    // For long positions: entry - stop loss
    if (entryPrice <= stopLoss) {
      throw new Error('Stop loss must be below entry price for Buy orders');
    }
    riskPerUnit = entryPrice - stopLoss;
  } else {
    // For short positions: stop loss - entry
    if (stopLoss <= entryPrice) {
      throw new Error('Stop loss must be above entry price for Sell orders');
    }
    riskPerUnit = stopLoss - entryPrice;
  }

  // Calculate fee percentages (convert from percentage to decimal)
  const entryFeeRate = feePercentage / 100; // Convert to decimal (e.g., 0.075% -> 0.00075)
  const exitFeeRate = feePercentage / 100;
  
  // Calculate position size directly based on risk formula
  // For a position size of X coins at price P:
  // X * abs(entry - stop) + X * P * entryFee + X * stopLoss * exitFee = riskAmount
  // Solve for X:
  
  // Calculate the effective risk per unit including fees
  const feeCostFactor = (entryPrice * entryFeeRate) + (stopLoss * exitFeeRate);
  const effectiveRiskPerUnit = riskPerUnit + feeCostFactor;
  
  // Calculate position size in coins
  const positionSizeCoins = riskAmount / effectiveRiskPerUnit;
  
  console.log(`Calculation details: 
    Risk per unit: ${riskPerUnit}
    Fee cost factor: ${feeCostFactor}
    Effective risk per unit: ${effectiveRiskPerUnit}
    Raw position size (coins): ${positionSizeCoins}`);
  
  // Apply any constraints (min quantity, step size, max position size)
  let finalQuantity = positionSizeCoins;
  
  // Ensure the quantity meets minimum requirements
  if (finalQuantity < minQty) {
    console.log(`Calculated quantity ${finalQuantity} is below minimum ${minQty}, using minimum`);
    finalQuantity = minQty;
  }
  
  // Round down to the nearest step size
  if (qtyStep > 0) {
    // Use Math.floor to ensure we always round down to stay within risk parameters
    finalQuantity = Math.floor(finalQuantity / qtyStep) * qtyStep;
    console.log(`Rounded quantity to step size (${qtyStep}): ${finalQuantity}`);
  }
  
  // Ensure we don't exceed max position size if specified
  if (maxPositionSize > 0) {
    const positionValueUSDT = finalQuantity * entryPrice;
    if (positionValueUSDT > maxPositionSize) {
      // Calculate maximum allowed quantity based on max position size
      const maxAllowedQty = maxPositionSize / entryPrice;
      // Round down to the nearest step size
      finalQuantity = Math.floor(maxAllowedQty / qtyStep) * qtyStep;
      console.log(`Reduced quantity to respect max position size (${maxPositionSize}): ${finalQuantity}`);
    }
  }
  
  // Apply precision (number of decimal places)
  finalQuantity = parseFloat(finalQuantity.toFixed(decimals));
  
  // Calculate actual risk with the adjusted quantity for logging purposes
  const actualRisk = (finalQuantity * riskPerUnit) + 
                    (finalQuantity * entryPrice * entryFeeRate) + 
                    (finalQuantity * stopLoss * exitFeeRate);
  
  console.log(`Final position size calculation:
    Final quantity: ${finalQuantity}
    Min quantity: ${minQty}
    Step size: ${qtyStep}
    Actual risk: ${actualRisk.toFixed(2)} USDT (target: ${riskAmount} USDT)
    Entry price: ${entryPrice}
    Stop loss: ${stopLoss}
    Risk per unit: ${riskPerUnit}
    Position value: ${(finalQuantity * entryPrice).toFixed(2)} USDT`);
  
  return finalQuantity;
}
